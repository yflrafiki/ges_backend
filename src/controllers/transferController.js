const pool = require('../config/db');

// @route  POST /api/transfers
// @access Teacher only
const createTransfer = async (req, res) => {
  const { reason, requested_district, requested_region } = req.body;

  if (!reason || !requested_district || !requested_region) {
    return res.status(400).json({ message: 'Reason, requested district and region are required' });
  }

  try {
    // Get teacher profile
    const teacherResult = await pool.query(
      'SELECT * FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found' });
    }

    const teacher = teacherResult.rows[0];

    // Check if teacher already has a pending transfer
    const existing = await pool.query(
      `SELECT id FROM applications 
       WHERE teacher_id = $1 AND type = 'transfer' AND status = 'pending'`,
      [teacher.id]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'You already have a pending transfer application' });
    }

    // Create application
    const result = await pool.query(
      `INSERT INTO applications 
        (teacher_id, type, reason, requested_district, requested_region)
       VALUES ($1, 'transfer', $2, $3, $4)
       RETURNING *`,
      [teacher.id, reason, requested_district, requested_region]
    );

    // Audit log
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'CREATE_TRANSFER', 'applications', result.rows[0].id, 'Teacher submitted transfer application']
    );

    res.status(201).json({
      message: 'Transfer application submitted successfully',
      application: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/transfers/my
// @access Teacher only
const getMyTransfers = async (req, res) => {
  try {
    const teacherResult = await pool.query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found' });
    }

    const result = await pool.query(
      `SELECT a.*, 
        u.email as reviewed_by_email
       FROM applications a
       LEFT JOIN users u ON a.reviewed_by = u.id
       WHERE a.teacher_id = $1 AND a.type = 'transfer'
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

// @route  GET /api/transfers
// @access HR Officer, Admin
const getAllTransfers = async (req, res) => {
  try {
    const { status, region, district } = req.query;

    let query = `
      SELECT a.*, 
        t.first_name, t.last_name, t.staff_id, 
        t.current_school, t.current_district, t.current_region,
        u.email as reviewed_by_email
       FROM applications a
       JOIN teachers t ON a.teacher_id = t.id
       LEFT JOIN users u ON a.reviewed_by = u.id
       WHERE a.type = 'transfer'
    `;
    const params = [];
    let count = 1;

    if (status) {
      query += ` AND a.status = $${count++}`;
      params.push(status);
    }

    if (region) {
      query += ` AND a.requested_region = $${count++}`;
      params.push(region);
    }

    if (district) {
      query += ` AND a.requested_district = $${count++}`;
      params.push(district);
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

// @route  GET /api/transfers/:id
// @access HR Officer, Admin, Teacher (own only)
const getTransferById = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.*, 
        t.first_name, t.last_name, t.staff_id,
        t.current_school, t.current_district, t.current_region,
        u.email as reviewed_by_email
       FROM applications a
       JOIN teachers t ON a.teacher_id = t.id
       LEFT JOIN users u ON a.reviewed_by = u.id
       WHERE a.id = $1 AND a.type = 'transfer'`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Transfer application not found' });
    }

    // If teacher, make sure they can only see their own
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

// @route  PUT /api/transfers/:id/review
// @access HR Officer, Admin
const reviewTransfer = async (req, res) => {
  const { status, hr_notes } = req.body;

  if (!status) {
    return res.status(400).json({ message: 'Status is required' });
  }

  if (!['approved', 'rejected', 'more_info'].includes(status)) {
    return res.status(400).json({ message: 'Status must be approved, rejected or more_info' });
  }

  try {
    // Get the application
    const appResult = await pool.query(
      'SELECT * FROM applications WHERE id = $1 AND type = $2',
      [req.params.id, 'transfer']
    );

    if (appResult.rows.length === 0) {
      return res.status(404).json({ message: 'Transfer application not found' });
    }

    const application = appResult.rows[0];

    if (application.status !== 'pending' && application.status !== 'more_info') {
      return res.status(400).json({ message: 'Application has already been reviewed' });
    }

    // Update application status
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

    // If approved — auto update teacher record
    if (status === 'approved') {
      const teacher = await pool.query(
        'SELECT * FROM teachers WHERE id = $1',
        [application.teacher_id]
      );

      // Save old district/region to history
      await pool.query(
        `INSERT INTO teacher_history 
          (teacher_id, changed_field, old_value, new_value, changed_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [application.teacher_id, 'current_district',
          teacher.rows[0].current_district,
          application.requested_district, req.user.id]
      );

      await pool.query(
        `INSERT INTO teacher_history 
          (teacher_id, changed_field, old_value, new_value, changed_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [application.teacher_id, 'current_region',
          teacher.rows[0].current_region,
          application.requested_region, req.user.id]
      );

      // Update teacher's district and region
      await pool.query(
        `UPDATE teachers SET
          current_district = $1,
          current_region = $2,
          updated_at = NOW()
         WHERE id = $3`,
        [application.requested_district, application.requested_region, application.teacher_id]
      );
    }

    // Audit log
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'REVIEW_TRANSFER', 'applications', req.params.id,
        `Transfer application ${status} by HR officer`]
    );

    res.json({
      message: `Transfer application ${status} successfully`,
      application: updated.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = {
  createTransfer,
  getMyTransfers,
  getAllTransfers,
  getTransferById,
  reviewTransfer
};