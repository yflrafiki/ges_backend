const pool = require('../config/db');

// @route  GET /api/teachers/profile
// @access Teacher only
const getMyProfile = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, u.email, u.role 
       FROM teachers t 
       JOIN users u ON t.user_id = u.id 
       WHERE t.user_id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  PUT /api/teachers/profile
// @access Teacher only
const updateMyProfile = async (req, res) => {
  const { phone, gender, subject_specialization, qualification } = req.body;

  try {
    // Get current profile first
    const current = await pool.query(
      'SELECT * FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found' });
    }

    const teacher = current.rows[0];

    // Track changes in history
    const fields = { phone, gender, subject_specialization, qualification };
    for (const [field, newValue] of Object.entries(fields)) {
      if (newValue !== undefined && newValue !== teacher[field]) {
        await pool.query(
          `INSERT INTO teacher_history 
            (teacher_id, changed_field, old_value, new_value, changed_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [teacher.id, field, teacher[field], newValue, req.user.id]
        );
      }
    }

    // Update profile
    const updated = await pool.query(
      `UPDATE teachers SET
        phone = COALESCE($1, phone),
        gender = COALESCE($2, gender),
        subject_specialization = COALESCE($3, subject_specialization),
        qualification = COALESCE($4, qualification),
        updated_at = NOW()
       WHERE user_id = $5
       RETURNING *`,
      [phone, gender, subject_specialization, qualification, req.user.id]
    );

    // Audit log
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'UPDATE_PROFILE', 'teachers', teacher.id, 'Teacher updated their profile']
    );

    res.json({
      message: 'Profile updated successfully',
      teacher: updated.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/teachers
// @access HR Officer, Admin
const getAllTeachers = async (req, res) => {
  try {
    const { district, region, grade, search } = req.query;

    let query = `
      SELECT t.*, u.email 
      FROM teachers t 
      JOIN users u ON t.user_id = u.id 
      WHERE 1=1
    `;
    const params = [];
    let count = 1;

    if (district) {
      query += ` AND t.current_district = $${count++}`;
      params.push(district);
    }

    if (region) {
      query += ` AND t.current_region = $${count++}`;
      params.push(region);
    }

    if (grade) {
      query += ` AND t.current_grade = $${count++}`;
      params.push(grade);
    }

    if (search) {
      query += ` AND (t.first_name ILIKE $${count} OR t.last_name ILIKE $${count} OR t.staff_id ILIKE $${count})`;
      params.push(`%${search}%`);
      count++;
    }

    query += ` ORDER BY t.created_at DESC`;

    const result = await pool.query(query, params);

    res.json({
      count: result.rows.length,
      teachers: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/teachers/:id
// @access HR Officer, Admin
const getTeacherById = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, u.email 
       FROM teachers t 
       JOIN users u ON t.user_id = u.id 
       WHERE t.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    // Get teacher history
    const history = await pool.query(
      `SELECT th.*, u.email as changed_by_email
       FROM teacher_history th
       JOIN users u ON th.changed_by = u.id
       WHERE th.teacher_id = $1
       ORDER BY th.changed_at DESC`,
      [req.params.id]
    );

    res.json({
      teacher: result.rows[0],
      history: history.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  PUT /api/teachers/:id
// @access HR Officer, Admin
const updateTeacherById = async (req, res) => {
  const { first_name, last_name, phone, gender, subject_specialization,
    current_grade, current_school, current_district, current_region,
    qualification, years_of_service } = req.body;

  try {
    // Get current record
    const current = await pool.query(
      'SELECT * FROM teachers WHERE id = $1',
      [req.params.id]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    const teacher = current.rows[0];

    // Track every changed field in history
    const fields = {
      first_name, last_name, phone, gender, subject_specialization,
      current_grade, current_school, current_district, current_region,
      qualification, years_of_service
    };

    for (const [field, newValue] of Object.entries(fields)) {
      if (newValue !== undefined && String(newValue) !== String(teacher[field])) {
        await pool.query(
          `INSERT INTO teacher_history 
            (teacher_id, changed_field, old_value, new_value, changed_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [teacher.id, field, teacher[field], newValue, req.user.id]
        );
      }
    }

    // Update the record
    const updated = await pool.query(
      `UPDATE teachers SET
        first_name = COALESCE($1, first_name),
        last_name = COALESCE($2, last_name),
        phone = COALESCE($3, phone),
        gender = COALESCE($4, gender),
        subject_specialization = COALESCE($5, subject_specialization),
        current_grade = COALESCE($6, current_grade),
        current_school = COALESCE($7, current_school),
        current_district = COALESCE($8, current_district),
        current_region = COALESCE($9, current_region),
        qualification = COALESCE($10, qualification),
        years_of_service = COALESCE($11, years_of_service),
        updated_at = NOW()
       WHERE id = $12
       RETURNING *`,
      [first_name, last_name, phone, gender, subject_specialization,
        current_grade, current_school, current_district, current_region,
        qualification, years_of_service, req.params.id]
    );

    // Audit log
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'UPDATE_TEACHER', 'teachers', teacher.id, `HR updated teacher ${teacher.staff_id}`]
    );

    res.json({
      message: 'Teacher record updated successfully',
      teacher: updated.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = {
  getMyProfile,
  updateMyProfile,
  getAllTeachers,
  getTeacherById,
  updateTeacherById
};