const pool = require('../config/db');
const { getNextGrade, MIN_YEARS_IN_RANK, computeYearsInRank } = require('./rankService');
const { notifyUser } = require('./notificationService');

// Runs daily — finds teachers who've crossed MIN_YEARS_IN_RANK since their
// national_date_of_present_rank and haven't been notified yet, and notifies
// each exactly once. promotion_eligibility_notified resets to false whenever
// a teacher is actually promoted (see promotionController.reviewPromotion),
// so this naturally re-fires for their next rank.
const checkAndNotifyEligibleTeachers = async () => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.user_id, t.first_name, t.last_name, t.current_grade, t.national_date_of_present_rank
       FROM teachers t
       WHERE t.promotion_eligibility_notified = false
         AND t.national_date_of_present_rank IS NOT NULL
         AND t.current_grade IS NOT NULL`
    );

    for (const teacher of result.rows) {
      const yearsInRank = computeYearsInRank(teacher.national_date_of_present_rank);
      const nextGrade = getNextGrade(teacher.current_grade);

      if (yearsInRank !== null && yearsInRank >= MIN_YEARS_IN_RANK && nextGrade) {
        await notifyUser(teacher.user_id, {
          type: 'promotion_eligible',
          title: 'You are eligible for promotion',
          message: `You now have ${yearsInRank.toFixed(1)} years in your current rank and are eligible to apply for promotion to ${nextGrade}.`,
          link: '/promotions',
          entityType: 'teacher',
          entityId: teacher.id,
        });

        await pool.query(
          'UPDATE teachers SET promotion_eligibility_notified = true WHERE id = $1',
          [teacher.id]
        );
      }
    }
  } catch (err) {
    console.error('Failed to check promotion eligibility:', err.message);
  }
};

module.exports = { checkAndNotifyEligibleTeachers };
