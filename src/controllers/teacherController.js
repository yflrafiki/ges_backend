const pool = require('../config/db');
const path = require('path');
const fs = require('fs');
const { computeYearsInRank } = require('../services/rankService');

// @route  GET /api/teachers/profile
// @access Teacher only
const getMyProfile = async (req, res) => {
  try {
    console.log('GET /api/teachers/profile for user', req.user.id, req.user.email || 'no-email');
    const result = await pool.query(
      `SELECT t.*, u.email, u.role 
       FROM teachers t 
       JOIN users u ON t.user_id = u.id 
       WHERE t.user_id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) {
      console.warn('Teacher profile not found for user', req.user.id);
      return res.status(404).json({ message: 'Teacher profile not found' });
    }
    const teacher = result.rows[0];
    if (teacher.passport_photo) {
      teacher.passport_photo = teacher.passport_photo.replace(/^\//, '');
      teacher.passport_photo_url = `${req.protocol}://${req.get('host')}/${teacher.passport_photo}`;
    }
    teacher.years_in_current_rank = computeYearsInRank(teacher.national_date_of_present_rank);
    res.json(teacher);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  PUT /api/teachers/profile
// @access Teacher only
// Teachers may only self-edit phone and marital_status directly (plus their passport photo).
// Every other field requires a change request reviewed by HR — see changeRequestController.js.
const updateMyProfile = async (req, res) => {
  const { phone, marital_status } = req.body;

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
    const fields = { phone, marital_status };

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
      passport_photo = `uploads/photos/${req.file.filename}`;
    }

    const updated = await pool.query(
      `UPDATE teachers SET
        phone = COALESCE($1, phone),
        marital_status = COALESCE($2, marital_status),
        passport_photo = COALESCE($3, passport_photo),
        updated_at = NOW()
       WHERE user_id = $4
       RETURNING *`,
      [phone, marital_status, passport_photo, req.user.id]
    );

    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'UPDATE_PROFILE', 'teachers', teacher.id, 'Teacher updated phone/marital status/photo']
    );

    const updatedTeacher = updated.rows[0];
    if (updatedTeacher.passport_photo) {
      updatedTeacher.passport_photo = updatedTeacher.passport_photo.replace(/^\//, '');
      updatedTeacher.passport_photo_url = `${req.protocol}://${req.get('host')}/${updatedTeacher.passport_photo}`;
    }

    res.json({ message: 'Profile updated successfully', teacher: updatedTeacher });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/teachers
// @access HR Officer (own region only), Admin (all regions)
const getAllTeachers = async (req, res) => {
  try {
    const { district, region, grade, qualification, search } = req.query;

    // HR officers are scoped to their assigned region — they cannot see other regions.
    // Admin has unrestricted, full visibility across all regions.
    if (req.user.role === 'hr_officer' && !req.user.region) {
      return res.status(403).json({ message: 'Your HR account has no region assigned. Contact an admin.' });
    }
    const effectiveRegion = req.user.role === 'hr_officer' ? req.user.region : region;

    let query = `
      SELECT t.*, u.email
      FROM teachers t
      JOIN users u ON t.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let count = 1;

    if (district) { query += ` AND t.current_district = $${count++}`; params.push(district); }
    if (effectiveRegion) { query += ` AND t.current_region = $${count++}`; params.push(effectiveRegion); }
    if (grade) { query += ` AND t.current_grade = $${count++}`; params.push(grade); }
    if (qualification) { query += ` AND t.qualification = $${count++}`; params.push(qualification); }
    if (search) {
      query += ` AND (t.first_name ILIKE $${count} OR t.last_name ILIKE $${count} OR t.staff_id ILIKE $${count})`;
      params.push(`%${search}%`);
      count++;
    }

    query += ` ORDER BY t.created_at DESC`;
    const result = await pool.query(query, params);
    const teachers = result.rows.map((t) => ({
      ...t,
      years_in_current_rank: computeYearsInRank(t.national_date_of_present_rank),
    }));
    res.json({ count: teachers.length, teachers });

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

    if (req.user.role === 'hr_officer' && result.rows[0].current_region !== req.user.region) {
      return res.status(403).json({ message: 'This teacher is outside your assigned region' });
    }

    const history = await pool.query(
      `SELECT th.*, u.email as changed_by_email
       FROM teacher_history th
       JOIN users u ON th.changed_by = u.id
       WHERE th.teacher_id = $1
       ORDER BY th.changed_at DESC`,
      [req.params.id]
    );

    const teacher = {
      ...result.rows[0],
      years_in_current_rank: computeYearsInRank(result.rows[0].national_date_of_present_rank),
    };
    res.json({ teacher, history: history.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  PUT /api/teachers/:id
// @access HR Officer, Admin
const updateTeacherById = async (req, res) => {
  // HR can ONLY update these fields. years_in_current_rank is deliberately
  // not here — it's derived from national_date_of_present_rank on every
  // read (see computeYearsInRank), never set directly.
  const {
    current_grade,
    current_school,
    current_district,
    current_region,
    subject_specialization,
    qualification,
    years_of_service,
    national_date_of_present_rank,
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

    if (req.user.role === 'hr_officer' && teacher.current_region !== req.user.region) {
      return res.status(403).json({ message: 'This teacher is outside your assigned region' });
    }

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
        date_of_first_appointment = COALESCE($9, date_of_first_appointment),
        date_of_confirmation = COALESCE($10, date_of_confirmation),
        date_of_current_posting = COALESCE($11, date_of_current_posting),
        employment_status = COALESCE($12, employment_status),
        updated_at = NOW()
       WHERE id = $13
       RETURNING *`,
      [
        current_grade, current_school, current_district, current_region,
        subject_specialization, qualification, years_of_service,
        national_date_of_present_rank,
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

    const responseTeacher = {
      ...updated.rows[0],
      years_in_current_rank: computeYearsInRank(updated.rows[0].national_date_of_present_rank),
    };
    res.json({ message: 'Teacher record updated successfully', teacher: responseTeacher });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  DELETE /api/teachers/:id
// @access Admin only
const deleteTeacher = async (req, res) => {
  const client = await pool.connect();
  try {
    const current = await client.query('SELECT * FROM teachers WHERE id = $1', [req.params.id]);

    if (current.rows.length === 0) {
      client.release();
      return res.status(404).json({ message: 'Teacher not found' });
    }

    const teacher = current.rows[0];

    await client.query('BEGIN');

    // Tables referencing teachers.id without ON DELETE CASCADE must be cleared first.
    await client.query('DELETE FROM exam_attempts WHERE teacher_id = $1', [teacher.id]);
    await client.query('DELETE FROM promotion_documents WHERE teacher_id = $1', [teacher.id]);
    await client.query('DELETE FROM credentials WHERE teacher_id = $1', [teacher.id]);
    await client.query('DELETE FROM documents WHERE teacher_id = $1', [teacher.id]);
    await client.query('DELETE FROM applications WHERE teacher_id = $1', [teacher.id]);
    await client.query('DELETE FROM teacher_history WHERE teacher_id = $1', [teacher.id]);
    // Keep historical audit_logs rows (don't delete them), just detach the FK so the user can be removed.
    await client.query('UPDATE audit_logs SET user_id = NULL WHERE user_id = $1', [teacher.user_id]);
    await client.query('DELETE FROM teachers WHERE id = $1', [teacher.id]);
    await client.query('DELETE FROM users WHERE id = $1', [teacher.user_id]);

    await client.query(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'DELETE_TEACHER', 'teachers', teacher.id,
        `Admin deleted teacher ${teacher.staff_id} (${teacher.first_name} ${teacher.last_name})`]
    );

    await client.query('COMMIT');
    res.json({ message: 'Teacher record deleted successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
};

module.exports = {
  getMyProfile,
  updateMyProfile,
  getAllTeachers,
  getTeacherById,
  updateTeacherById,
  deleteTeacher
};