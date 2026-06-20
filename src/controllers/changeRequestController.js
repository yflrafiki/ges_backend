const pool = require('../config/db');

// Teachers cannot directly edit these teacher_history fields below — they must
// request a change here and have HR approve it. (phone/marital_status are excluded
// because teachers can already edit those directly via PUT /api/teachers/profile.)
const REQUESTABLE_FIELDS = [
  'first_name', 'last_name', 'title', 'date_of_birth', 'gender',
  'subject_specialization', 'qualification', 'nationality', 'hometown',
  'house_number', 'ghana_card_number', 'ghana_card_issue_date', 'ghana_card_expiry_date',
  'disability_status', 'disability_type',
];

// @route  POST /api/change-requests
// @access Teacher only
const createChangeRequest = async (req, res) => {
  const { field_name, requested_value, reason } = req.body;

  if (!field_name || requested_value === undefined || requested_value === '') {
    return res.status(400).json({ message: 'field_name and requested_value are required' });
  }

  if (!REQUESTABLE_FIELDS.includes(field_name)) {
    return res.status(400).json({ message: `Field '${field_name}' cannot be changed by request` });
  }

  try {
    const teacherResult = await pool.query('SELECT * FROM teachers WHERE user_id = $1', [req.user.id]);
    if (teacherResult.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found' });
    }
    const teacher = teacherResult.rows[0];

    const existing = await pool.query(
      `SELECT id FROM change_requests WHERE teacher_id = $1 AND field_name = $2 AND status = 'pending'`,
      [teacher.id, field_name]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'You already have a pending change request for this field' });
    }

    const result = await pool.query(
      `INSERT INTO change_requests (teacher_id, field_name, current_value, requested_value, reason)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [teacher.id, field_name, teacher[field_name], requested_value, reason || null]
    );

    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'CREATE_CHANGE_REQUEST', 'change_requests', result.rows[0].id,
        `Teacher requested change to ${field_name}`]
    );

    res.status(201).json({ message: 'Change request submitted for HR approval', request: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/change-requests/my
// @access Teacher only
const getMyChangeRequests = async (req, res) => {
  try {
    const teacherResult = await pool.query('SELECT id FROM teachers WHERE user_id = $1', [req.user.id]);
    if (teacherResult.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found' });
    }

    const result = await pool.query(
      `SELECT cr.*, u.email as reviewed_by_email
       FROM change_requests cr
       LEFT JOIN users u ON cr.reviewed_by = u.id
       WHERE cr.teacher_id = $1
       ORDER BY cr.created_at DESC`,
      [teacherResult.rows[0].id]
    );

    res.json({ count: result.rows.length, requests: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/change-requests
// @access HR Officer (own region), Admin (all)
const getAllChangeRequests = async (req, res) => {
  try {
    const { status } = req.query;

    if (req.user.role === 'hr_officer' && !req.user.region) {
      return res.status(403).json({ message: 'Your HR account has no region assigned. Contact an admin.' });
    }

    let query = `
      SELECT cr.*, t.first_name, t.last_name, t.staff_id, t.current_region, t.current_district,
        u.email as reviewed_by_email
       FROM change_requests cr
       JOIN teachers t ON cr.teacher_id = t.id
       LEFT JOIN users u ON cr.reviewed_by = u.id
       WHERE 1=1
    `;
    const params = [];
    let count = 1;

    if (status) { query += ` AND cr.status = $${count++}`; params.push(status); }
    if (req.user.role === 'hr_officer') { query += ` AND t.current_region = $${count++}`; params.push(req.user.region); }

    query += ` ORDER BY cr.created_at DESC`;

    const result = await pool.query(query, params);
    res.json({ count: result.rows.length, requests: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  PUT /api/change-requests/:id/review
// @access HR Officer (own region), Admin (all)
const reviewChangeRequest = async (req, res) => {
  const { status, hr_notes } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Status must be approved or rejected' });
  }

  try {
    const requestResult = await pool.query(
      `SELECT cr.*, t.current_region FROM change_requests cr
       JOIN teachers t ON cr.teacher_id = t.id
       WHERE cr.id = $1`,
      [req.params.id]
    );

    if (requestResult.rows.length === 0) {
      return res.status(404).json({ message: 'Change request not found' });
    }

    const changeRequest = requestResult.rows[0];

    if (changeRequest.status !== 'pending') {
      return res.status(400).json({ message: 'This request has already been reviewed' });
    }

    if (req.user.role === 'hr_officer' && changeRequest.current_region !== req.user.region) {
      return res.status(403).json({ message: 'This request is outside your assigned region' });
    }

    if (status === 'approved') {
      if (!REQUESTABLE_FIELDS.includes(changeRequest.field_name)) {
        return res.status(400).json({ message: 'Invalid field on change request' });
      }

      await pool.query(
        `UPDATE teachers SET ${changeRequest.field_name} = $1, updated_at = NOW() WHERE id = $2`,
        [changeRequest.requested_value, changeRequest.teacher_id]
      );

      await pool.query(
        `INSERT INTO teacher_history (teacher_id, changed_field, old_value, new_value, changed_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [changeRequest.teacher_id, changeRequest.field_name, changeRequest.current_value,
          changeRequest.requested_value, req.user.id]
      );
    }

    const updated = await pool.query(
      `UPDATE change_requests SET status = $1, hr_notes = $2, reviewed_by = $3, reviewed_at = NOW()
       WHERE id = $4 RETURNING *`,
      [status, hr_notes || null, req.user.id, req.params.id]
    );

    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'REVIEW_CHANGE_REQUEST', 'change_requests', req.params.id,
        `Change request for ${changeRequest.field_name} ${status}`]
    );

    res.json({ message: `Change request ${status}`, request: updated.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = {
  createChangeRequest,
  getMyChangeRequests,
  getAllChangeRequests,
  reviewChangeRequest,
};
