const pool = require('../config/db');
const path = require('path');
const fs = require('fs');

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
  const {
    phone, gender, subject_specialization, qualification,
    title, marital_status, nationality, hometown,
    national_date_of_present_rank, years_in_current_rank,
    disability_status, disability_type
  } = req.body;

  try {
    const current = await pool.query(
      'SELECT * FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found' });
    }

    const teacher = current.rows[0];

    // Track changes
    const fields = {
      phone, gender, subject_specialization, qualification,
      title, marital_status, nationality, hometown,
      national_date_of_present_rank, years_in_current_rank,
      disability_status, disability_type
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

    // Handle passport photo upload
    let passport_photo = teacher.passport_photo;
    if (req.file) {
      passport_photo = req.file.path;
    }

    const updated = await pool.query(
      `UPDATE teachers SET
        phone = COALESCE($1, phone),
        gender = COALESCE($2, gender),
        subject_specialization = COALESCE($3, subject_specialization),
        qualification = COALESCE($4, qualification),
        title = COALESCE($5, title),
        marital_status = COALESCE($6, marital_status),
        nationality = COALESCE($7, nationality),
        hometown = COALESCE($8, hometown),
        national_date_of_present_rank = COALESCE($9, national_date_of_present_rank),
        years_in_current_rank = COALESCE($10, years_in_current_rank),
        disability_status = COALESCE($11, disability_status),
        disability_type = COALESCE($12, disability_type),
        passport_photo = COALESCE($13, passport_photo),
        updated_at = NOW()
       WHERE user_id = $14
       RETURNING *`,
      [
        phone, gender, subject_specialization, qualification,
        title, marital_status, nationality, hometown,
        national_date_of_present_rank, years_in_current_rank,
        disability_status, disability_type,
        passport_photo, req.user.id
      ]
    );

    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'UPDATE_PROFILE', 'teachers', teacher.id, 'Teacher updated profile']
    );

    res.json({ message: 'Profile updated successfully', teacher: updated.rows[0] });

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

    if (district) { query += ` AND t.current_district = $${count++}`; params.push(district); }
    if (region) { query += ` AND t.current_region = $${count++}`; params.push(region); }
    if (grade) { query += ` AND t.current_grade = $${count++}`; params.push(grade); }
    if (search) {
      query += ` AND (t.first_name ILIKE $${count} OR t.last_name ILIKE $${count} OR t.staff_id ILIKE $${count})`;
      params.push(`%${search}%`);
      count++;
    }

    query += ` ORDER BY t.created_at DESC`;
    const result = await pool.query(query, params);
    res.json({ count: result.rows.length, teachers: result.rows });

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

    const history = await pool.query(
      `SELECT th.*, u.email as changed_by_email
       FROM teacher_history th
       JOIN users u ON th.changed_by = u.id
       WHERE th.teacher_id = $1
       ORDER BY th.changed_at DESC`,
      [req.params.id]
    );

    res.json({ teacher: result.rows[0], history: history.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  PUT /api/teachers/:id
// @access HR Officer, Admin
const updateTeacherById = async (req, res) => {
  // HR can ONLY update these fields
  const {
    current_grade,
    current_school,
    current_district,
    current_region,
    subject_specialization,
    qualification,
    years_of_service,
    national_date_of_present_rank,
    years_in_current_rank,
    date_of_first_appointment,
    date_of_confirmation,
    date_of_current_posting,
    employment_status,
  } = req.body;

  try {
    const current = await pool.query(
      'SELECT * FROM teachers WHERE id = $1',
      [req.params.id]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    const teacher = current.rows[0];

    // Track changes for HR-editable fields only
    const fields = {
      current_grade,
      current_school,
      current_district,
      current_region,
      subject_specialization,
      qualification,
      years_of_service,
      national_date_of_present_rank,
      years_in_current_rank,
      date_of_first_appointment,
      date_of_confirmation,
      date_of_current_posting,
      employment_status,
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

    const updated = await pool.query(
      `UPDATE teachers SET
        current_grade = COALESCE($1, current_grade),
        current_school = COALESCE($2, current_school),
        current_district = COALESCE($3, current_district),
        current_region = COALESCE($4, current_region),
        subject_specialization = COALESCE($5, subject_specialization),
        qualification = COALESCE($6, qualification),
        years_of_service = COALESCE($7, years_of_service),
        national_date_of_present_rank = COALESCE($8, national_date_of_present_rank),
        years_in_current_rank = COALESCE($9, years_in_current_rank),
        date_of_first_appointment = COALESCE($10, date_of_first_appointment),
        date_of_confirmation = COALESCE($11, date_of_confirmation),
        date_of_current_posting = COALESCE($12, date_of_current_posting),
        employment_status = COALESCE($13, employment_status),
        updated_at = NOW()
       WHERE id = $14
       RETURNING *`,
      [
        current_grade, current_school, current_district, current_region,
        subject_specialization, qualification, years_of_service,
        national_date_of_present_rank, years_in_current_rank,
        date_of_first_appointment, date_of_confirmation,
        date_of_current_posting, employment_status,
        req.params.id
      ]
    );

    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'UPDATE_TEACHER', 'teachers', teacher.id,
        `HR updated employment/professional details for teacher ${teacher.staff_id}`]
    );

    res.json({ message: 'Teacher record updated successfully', teacher: updated.rows[0] });

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