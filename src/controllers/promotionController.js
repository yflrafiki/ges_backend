const pool = require('../config/db');

// Eligibility rules
const ELIGIBILITY_RULES = {
  'Grade C': { minYears: 3, requiredQualification: ['Certificate', 'Diploma', 'B.Ed', 'B.A', 'B.Sc'] },
  'Grade B': { minYears: 4, requiredQualification: ['B.Ed', 'B.A', 'B.Sc', 'M.Ed', 'M.A', 'M.Sc'] },
  'Grade A': { minYears: 5, requiredQualification: ['M.Ed', 'M.A', 'M.Sc', 'PhD'] },
  'Principal': { minYears: 8, requiredQualification: ['M.Ed', 'M.A', 'M.Sc', 'PhD'] },
  'Director': { minYears: 10, requiredQualification: ['PhD'] },
};

const getNextGrade = (currentGrade) => {
  const gradeOrder = ['Grade C', 'Grade B', 'Grade A', 'Principal', 'Director'];
  const currentIndex = gradeOrder.indexOf(currentGrade);
  if (currentIndex === -1 || currentIndex === gradeOrder.length - 1) return null;
  return gradeOrder[currentIndex + 1];
};

const checkEligibility = (teacher) => {
  const nextGrade = getNextGrade(teacher.current_grade);
  if (!nextGrade) {
    return { eligible: false, reason: 'Teacher is already at the highest grade' };
  }

  const rules = ELIGIBILITY_RULES[nextGrade];
  if (!rules) {
    return { eligible: false, reason: 'No eligibility rules found for next grade' };
  }

  if (teacher.years_of_service < rules.minYears) {
    return {
      eligible: false,
      reason: `Minimum ${rules.minYears} years of service required for ${nextGrade}. You have ${teacher.years_of_service} years.`
    };
  }

  if (!rules.requiredQualification.includes(teacher.qualification)) {
    return {
      eligible: false,
      reason: `Qualification '${teacher.qualification}' is not sufficient for ${nextGrade}. Required: ${rules.requiredQualification.join(', ')}`
    };
  }

  return { eligible: true, nextGrade };
};

// @route  GET /api/promotions/eligibility
// @access Teacher only
const checkPromotionEligibility = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found' });
    }

    const teacher = result.rows[0];
    const eligibility = checkEligibility(teacher);

    res.json({
      teacher: {
        name: `${teacher.first_name} ${teacher.last_name}`,
        current_grade: teacher.current_grade,
        years_of_service: teacher.years_of_service,
        qualification: teacher.qualification
      },
      ...eligibility
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  POST /api/promotions
// @access Teacher only
const applyForPromotion = async (req, res) => {
  const { reason } = req.body;

  if (!reason) {
    return res.status(400).json({ message: 'Reason for promotion is required' });
  }

  try {
    const teacherResult = await pool.query(
      'SELECT * FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found' });
    }

    const teacher = teacherResult.rows[0];

    // Check eligibility before allowing application
    const eligibility = checkEligibility(teacher);
    if (!eligibility.eligible) {
      return res.status(400).json({
        message: 'You are not eligible for promotion',
        reason: eligibility.reason
      });
    }

    // Check if already has a pending promotion
    const existing = await pool.query(
      `SELECT id FROM applications 
       WHERE teacher_id = $1 AND type = 'promotion' AND status = 'pending'`,
      [teacher.id]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'You already have a pending promotion application' });
    }

    // Create application
    const result = await pool.query(
      `INSERT INTO applications 
        (teacher_id, type, reason)
       VALUES ($1, 'promotion', $2)
       RETURNING *`,
      [teacher.id, reason]
    );

    // Audit log
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'CREATE_PROMOTION', 'applications', result.rows[0].id,
        `Teacher applied for promotion to ${eligibility.nextGrade}`]
    );

    res.status(201).json({
      message: 'Promotion application submitted successfully',
      next_grade: eligibility.nextGrade,
      application: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/promotions/my
// @access Teacher only
const getMyPromotions = async (req, res) => {
  try {
    const teacherResult = await pool.query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found' });
    }

    const result = await pool.query(
      `SELECT a.*, u.email as reviewed_by_email
       FROM applications a
       LEFT JOIN users u ON a.reviewed_by = u.id
       WHERE a.teacher_id = $1 AND a.type = 'promotion'
       ORDER BY a.created_at DESC`,
      [teacherResult.rows[0].id]
    );

    res.json({
      count: result.rows.length,
      applications: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/promotions
// @access HR Officer, Admin
const getAllPromotions = async (req, res) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT a.*,
        t.first_name, t.last_name, t.staff_id,
        t.current_grade, t.years_of_service, t.qualification,
        u.email as reviewed_by_email
       FROM applications a
       JOIN teachers t ON a.teacher_id = t.id
       LEFT JOIN users u ON a.reviewed_by = u.id
       WHERE a.type = 'promotion'
    `;
    const params = [];

    if (status) {
      query += ` AND a.status = $1`;
      params.push(status);
    }

    query += ` ORDER BY a.created_at DESC`;

    const result = await pool.query(query, params);

    res.json({
      count: result.rows.length,
      applications: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/promotions/:id
// @access HR Officer, Admin, Teacher (own only)
const getPromotionById = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.*,
        t.first_name, t.last_name, t.staff_id,
        t.current_grade, t.years_of_service, t.qualification,
        u.email as reviewed_by_email
       FROM applications a
       JOIN teachers t ON a.teacher_id = t.id
       LEFT JOIN users u ON a.reviewed_by = u.id
       WHERE a.id = $1 AND a.type = 'promotion'`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Promotion application not found' });
    }

    // If teacher make sure they only see their own
    if (req.user.role === 'teacher') {
      const teacher = await pool.query(
        'SELECT id FROM teachers WHERE user_id = $1',
        [req.user.id]
      );
      if (result.rows[0].teacher_id !== teacher.rows[0].id) {
        return res.status(403).json({ message: 'Not authorized to view this application' });
      }
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  PUT /api/promotions/:id/review
// @access HR Officer, Admin
const reviewPromotion = async (req, res) => {
  const { status, hr_notes } = req.body;

  if (!status) {
    return res.status(400).json({ message: 'Status is required' });
  }

  if (!['approved', 'rejected', 'more_info'].includes(status)) {
    return res.status(400).json({ message: 'Status must be approved, rejected or more_info' });
  }

  try {
    const appResult = await pool.query(
      'SELECT * FROM applications WHERE id = $1 AND type = $2',
      [req.params.id, 'promotion']
    );

    if (appResult.rows.length === 0) {
      return res.status(404).json({ message: 'Promotion application not found' });
    }

    const application = appResult.rows[0];

    if (application.status !== 'pending' && application.status !== 'more_info') {
      return res.status(400).json({ message: 'Application has already been reviewed' });
    }

    // Update application
    const updated = await pool.query(
      `UPDATE applications SET
        status = $1,
        hr_notes = $2,
        reviewed_by = $3,
        reviewed_at = NOW(),
        updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [status, hr_notes || null, req.user.id, req.params.id]
    );

    // If approved — auto update teacher grade
    if (status === 'approved') {
      const teacherResult = await pool.query(
        'SELECT * FROM teachers WHERE id = $1',
        [application.teacher_id]
      );

      const teacher = teacherResult.rows[0];
      const nextGrade = getNextGrade(teacher.current_grade);

      if (nextGrade) {
        // Save old grade to history
        await pool.query(
          `INSERT INTO teacher_history
            (teacher_id, changed_field, old_value, new_value, changed_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [teacher.id, 'current_grade', teacher.current_grade, nextGrade, req.user.id]
        );

        // Update teacher grade
        await pool.query(
          `UPDATE teachers SET
            current_grade = $1,
            updated_at = NOW()
           WHERE id = $2`,
          [nextGrade, teacher.id]
        );
      }
    }

    // Audit log
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'REVIEW_PROMOTION', 'applications', req.params.id,
        `Promotion application ${status} by HR officer`]
    );

    res.json({
      message: `Promotion application ${status} successfully`,
      application: updated.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = {
  checkPromotionEligibility,
  applyForPromotion,
  getMyPromotions,
  getAllPromotions,
  getPromotionById,
  reviewPromotion
};