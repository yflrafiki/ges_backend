const pool = require('../config/db');

const generateFallbackStaffId = (userId) => {
  const prefix = `TCH-${userId.slice(0, 8)}`;
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${suffix}`;
};

const ensureTeacherProfile = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'teacher') {
      return res.status(403).json({ message: 'Teacher access required' });
    }

    const result = await pool.query('SELECT * FROM teachers WHERE user_id = $1', [req.user.id]);
    if (result.rows.length > 0) {
      req.teacher = result.rows[0];
      return next();
    }

    const fallbackStaffId = generateFallbackStaffId(req.user.id);
    const insertResult = await pool.query(
      `INSERT INTO teachers (
          user_id, staff_id, first_name, last_name, current_grade,
          current_school, current_district, current_region,
          qualification, employment_status, years_of_service
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        req.user.id,
        fallbackStaffId,
        'Unknown',
        'Teacher',
        'Grade C',
        'Unknown',
        'Unknown',
        'Unknown',
        'Unknown',
        'active',
        0
      ]
    );

    req.teacher = insertResult.rows[0];
    console.warn(`Created placeholder teacher profile for user ${req.user.id}`);
    next();
  } catch (error) {
    console.error('ensureTeacherProfile error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = ensureTeacherProfile;
