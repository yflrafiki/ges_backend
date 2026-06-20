const pool = require('../config/db');

// @route  GET /api/reports/summary
// @access Admin, HR Officer
const getDashboardSummary = async (req, res) => {
  try {
    const isHr = req.user.role === 'hr_officer';
    if (isHr && !req.user.region) {
      return res.status(403).json({ message: 'Your HR account has no region assigned. Contact an admin.' });
    }

    // Total teachers (HR scoped to their own region)
    const teachersCount = isHr
      ? await pool.query('SELECT COUNT(*) FROM teachers WHERE current_region = $1', [req.user.region])
      : await pool.query('SELECT COUNT(*) FROM teachers');

    // Total applications — for HR, only ones relevant to their region:
    // transfers requesting their region, promotions/others from teachers currently in their region.
    const applicationsCount = isHr
      ? await pool.query(
          `SELECT COUNT(*) FROM applications a
           JOIN teachers t ON a.teacher_id = t.id
           WHERE (a.type = 'transfer' AND a.requested_region = $1)
              OR (a.type != 'transfer' AND t.current_region = $1)`,
          [req.user.region]
        )
      : await pool.query('SELECT COUNT(*) FROM applications');

    // Transfer stats — scoped to transfers requesting the HR's region
    const transferStats = isHr
      ? await pool.query(
          `SELECT status, COUNT(*) as count
           FROM applications
           WHERE type = 'transfer' AND requested_region = $1
           GROUP BY status`,
          [req.user.region]
        )
      : await pool.query(`
          SELECT status, COUNT(*) as count
          FROM applications
          WHERE type = 'transfer'
          GROUP BY status
        `);

    // Promotion stats — scoped to teachers currently in the HR's region
    const promotionStats = isHr
      ? await pool.query(
          `SELECT a.status, COUNT(*) as count
           FROM applications a
           JOIN teachers t ON a.teacher_id = t.id
           WHERE a.type = 'promotion' AND t.current_region = $1
           GROUP BY a.status`,
          [req.user.region]
        )
      : await pool.query(`
          SELECT status, COUNT(*) as count
          FROM applications
          WHERE type = 'promotion'
          GROUP BY status
        `);

    // Credential stats — scoped to teachers currently in the HR's region
    const credentialStats = isHr
      ? await pool.query(
          `SELECT c.verification_status, COUNT(*) as count
           FROM credentials c
           JOIN teachers t ON c.teacher_id = t.id
           WHERE t.current_region = $1
           GROUP BY c.verification_status`,
          [req.user.region]
        )
      : await pool.query(`
          SELECT verification_status, COUNT(*) as count
          FROM credentials
          GROUP BY verification_status
        `);

    // Teachers by region (HR only ever has one region, so just their own count)
    const teachersByRegion = isHr
      ? { rows: [{ current_region: req.user.region, count: String(teachersCount.rows[0].count) }] }
      : await pool.query(`
          SELECT current_region, COUNT(*) as count
          FROM teachers
          GROUP BY current_region
          ORDER BY count DESC
        `);

    // Teachers by grade (HR scoped to their own region)
    const teachersByGrade = isHr
      ? await pool.query(
          `SELECT current_grade, COUNT(*) as count
           FROM teachers
           WHERE current_region = $1
           GROUP BY current_grade
           ORDER BY count DESC`,
          [req.user.region]
        )
      : await pool.query(`
          SELECT current_grade, COUNT(*) as count
          FROM teachers
          GROUP BY current_grade
          ORDER BY count DESC
        `);

    // Recent applications (last 7 days), same region scoping as applicationsCount
    const recentApplications = isHr
      ? await pool.query(
          `SELECT COUNT(*) as count FROM applications a
           JOIN teachers t ON a.teacher_id = t.id
           WHERE a.created_at >= NOW() - INTERVAL '7 days'
             AND ((a.type = 'transfer' AND a.requested_region = $1)
               OR (a.type != 'transfer' AND t.current_region = $1))`,
          [req.user.region]
        )
      : await pool.query(`
          SELECT COUNT(*) as count
          FROM applications
          WHERE created_at >= NOW() - INTERVAL '7 days'
        `);

    res.json({
      summary: {
        total_teachers: parseInt(teachersCount.rows[0].count),
        total_applications: parseInt(applicationsCount.rows[0].count),
        recent_applications_7days: parseInt(recentApplications.rows[0].count)
      },
      transfers: transferStats.rows,
      promotions: promotionStats.rows,
      credentials: credentialStats.rows,
      teachers_by_region: teachersByRegion.rows,
      teachers_by_grade: teachersByGrade.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/reports/transfers
// @access Admin, HR Officer
const getTransferReport = async (req, res) => {
  try {
    const { from_date, to_date, region, status } = req.query;

    if (req.user.role === 'hr_officer' && !req.user.region) {
      return res.status(403).json({ message: 'Your HR account has no region assigned. Contact an admin.' });
    }

    let query = `
      SELECT 
        a.id, a.status, a.reason, a.created_at, a.reviewed_at,
        a.requested_district, a.requested_region, a.hr_notes,
        t.first_name, t.last_name, t.staff_id,
        t.current_school, t.current_district, t.current_region,
        t.current_grade, t.years_of_service,
        u.email as reviewed_by_email
      FROM applications a
      JOIN teachers t ON a.teacher_id = t.id
      LEFT JOIN users u ON a.reviewed_by = u.id
      WHERE a.type = 'transfer'
    `;
    const params = [];
    let count = 1;

    if (from_date) {
      query += ` AND a.created_at >= $${count++}`;
      params.push(from_date);
    }

    if (to_date) {
      query += ` AND a.created_at <= $${count++}`;
      params.push(to_date);
    }

    if (req.user.role === 'hr_officer') {
      query += ` AND a.requested_region = $${count++}`;
      params.push(req.user.region);
    } else if (region) {
      query += ` AND a.requested_region = $${count++}`;
      params.push(region);
    }

    if (status) {
      query += ` AND a.status = $${count++}`;
      params.push(status);
    }

    query += ` ORDER BY a.created_at DESC`;

    const result = await pool.query(query, params);

    // Stats summary
    const stats = {
      total: result.rows.length,
      approved: result.rows.filter(r => r.status === 'approved').length,
      rejected: result.rows.filter(r => r.status === 'rejected').length,
      pending: result.rows.filter(r => r.status === 'pending').length,
      more_info: result.rows.filter(r => r.status === 'more_info').length
    };

    res.json({
      stats,
      transfers: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/reports/promotions
// @access Admin, HR Officer
const getPromotionReport = async (req, res) => {
  try {
    const { from_date, to_date, status, grade } = req.query;

    if (req.user.role === 'hr_officer' && !req.user.region) {
      return res.status(403).json({ message: 'Your HR account has no region assigned. Contact an admin.' });
    }

    let query = `
      SELECT
        a.id, a.status, a.reason, a.created_at, a.reviewed_at, a.hr_notes,
        t.first_name, t.last_name, t.staff_id,
        t.current_grade, t.years_of_service, t.qualification,
        t.current_school, t.current_district, t.current_region,
        u.email as reviewed_by_email
      FROM applications a
      JOIN teachers t ON a.teacher_id = t.id
      LEFT JOIN users u ON a.reviewed_by = u.id
      WHERE a.type = 'promotion'
    `;
    const params = [];
    let count = 1;

    if (from_date) {
      query += ` AND a.created_at >= $${count++}`;
      params.push(from_date);
    }

    if (to_date) {
      query += ` AND a.created_at <= $${count++}`;
      params.push(to_date);
    }

    if (status) {
      query += ` AND a.status = $${count++}`;
      params.push(status);
    }

    if (grade) {
      query += ` AND t.current_grade = $${count++}`;
      params.push(grade);
    }

    if (req.user.role === 'hr_officer') {
      query += ` AND t.current_region = $${count++}`;
      params.push(req.user.region);
    }

    query += ` ORDER BY a.created_at DESC`;

    const result = await pool.query(query, params);

    const stats = {
      total: result.rows.length,
      approved: result.rows.filter(r => r.status === 'approved').length,
      rejected: result.rows.filter(r => r.status === 'rejected').length,
      pending: result.rows.filter(r => r.status === 'pending').length
    };

    res.json({
      stats,
      promotions: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/reports/credentials
// @access Admin, HR Officer
const getCredentialReport = async (req, res) => {
  try {
    if (req.user.role === 'hr_officer' && !req.user.region) {
      return res.status(403).json({ message: 'Your HR account has no region assigned. Contact an admin.' });
    }

    let query = `
      SELECT
        c.id, c.verification_status, c.document_hash,
        c.blockchain_tx_id, c.verified_at, c.created_at,
        d.file_name, d.file_type, d.ocr_status,
        t.first_name, t.last_name, t.staff_id,
        t.current_school, t.current_district, t.current_region
      FROM credentials c
      JOIN documents d ON c.document_id = d.id
      JOIN teachers t ON c.teacher_id = t.id
      WHERE 1=1
    `;
    const params = [];
    if (req.user.role === 'hr_officer') {
      query += ` AND t.current_region = $1`;
      params.push(req.user.region);
    }
    query += ` ORDER BY c.created_at DESC`;

    const result = await pool.query(query, params);

    const stats = {
      total: result.rows.length,
      verified: result.rows.filter(r => r.verification_status === 'verified').length,
      unverified: result.rows.filter(r => r.verification_status === 'unverified').length,
      failed: result.rows.filter(r => r.verification_status === 'failed').length
    };

    res.json({
      stats,
      credentials: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/reports/audit
// @access Admin only
const getAuditLog = async (req, res) => {
  try {
    const { from_date, to_date, action, user_id } = req.query;

    let query = `
      SELECT
        al.id, al.action, al.entity, al.entity_id,
        al.details, al.ip_address, al.created_at,
        u.email, u.role
      FROM audit_logs al
      JOIN users u ON al.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let count = 1;

    if (from_date) {
      query += ` AND al.created_at >= $${count++}`;
      params.push(from_date);
    }

    if (to_date) {
      query += ` AND al.created_at <= $${count++}`;
      params.push(to_date);
    }

    if (action) {
      query += ` AND al.action = $${count++}`;
      params.push(action);
    }

    if (user_id) {
      query += ` AND al.user_id = $${count++}`;
      params.push(user_id);
    }

    query += ` ORDER BY al.created_at DESC LIMIT 500`;

    const result = await pool.query(query, params);

    res.json({
      count: result.rows.length,
      logs: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/reports/teacher/:id/history
// @access Admin, HR Officer
const getTeacherHistory = async (req, res) => {
  try {
    // Get teacher details
    const teacherResult = await pool.query(
      `SELECT t.*, u.email 
       FROM teachers t 
       JOIN users u ON t.user_id = u.id 
       WHERE t.id = $1`,
      [req.params.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    if (req.user.role === 'hr_officer' && teacherResult.rows[0].current_region !== req.user.region) {
      return res.status(403).json({ message: 'This teacher is outside your assigned region' });
    }

    // Get full change history
    const history = await pool.query(
      `SELECT th.*, u.email as changed_by_email
       FROM teacher_history th
       JOIN users u ON th.changed_by = u.id
       WHERE th.teacher_id = $1
       ORDER BY th.changed_at DESC`,
      [req.params.id]
    );

    // Get all applications
    const applications = await pool.query(
      `SELECT a.*, u.email as reviewed_by_email
       FROM applications a
       LEFT JOIN users u ON a.reviewed_by = u.id
       WHERE a.teacher_id = $1
       ORDER BY a.created_at DESC`,
      [req.params.id]
    );

    // Get all credentials
    const credentials = await pool.query(
      `SELECT c.*, d.file_name
       FROM credentials c
       JOIN documents d ON c.document_id = d.id
       WHERE c.teacher_id = $1
       ORDER BY c.created_at DESC`,
      [req.params.id]
    );

    res.json({
      teacher: teacherResult.rows[0],
      change_history: history.rows,
      applications: applications.rows,
      credentials: credentials.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = {
  getDashboardSummary,
  getTransferReport,
  getPromotionReport,
  getCredentialReport,
  getAuditLog,
  getTeacherHistory
};