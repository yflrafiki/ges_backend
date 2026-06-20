const pool = require('../config/db');
const {
  verifyOnBlockchain,
  getNetworkStatus
} = require('../services/blockchainService');

// @route  GET /api/credentials/my
// @access Teacher only
const getMyCredentials = async (req, res) => {
  try {
    console.log('GET /api/credentials/my for user', req.user.id);
    const teacherResult = await pool.query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      console.warn('Teacher profile not found for user', req.user.id);
      return res.status(404).json({ message: 'Teacher not found' });
    }

    const result = await pool.query(
      `SELECT c.*, d.file_name, d.file_type, d.ocr_status
       FROM credentials c
       JOIN documents d ON c.document_id = d.id
       WHERE c.teacher_id = $1
       ORDER BY c.created_at DESC`,
      [teacherResult.rows[0].id]
    );

    res.json({ count: result.rows.length, credentials: result.rows });

  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/credentials/check/:txId
// @access HR Officer, Admin — Flow 2 (Verification)
const verifyCredentialByTxId = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, d.file_name, d.file_type,
        t.first_name, t.last_name, t.staff_id
       FROM credentials c
       JOIN documents d ON c.document_id = d.id
       JOIN teachers t ON c.teacher_id = t.id
       WHERE c.blockchain_tx_id = $1`,
      [req.params.txId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        verified: false,
        result: 'not_found',
        message: 'No credential found with this transaction ID'
      });
    }

    const credential = result.rows[0];

    // Run Flow 2 — full verification
    const verification = await verifyOnBlockchain(
      credential.document_hash,
      req.params.txId
    );

    // Log the verification attempt
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.id,
        'BLOCKCHAIN_VERIFY',
        'credentials',
        credential.id,
        `Verification result: ${verification.result}. TX: ${req.params.txId}`
      ]
    );

    res.json(verification);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/credentials/teacher/:teacherId
// @access HR Officer, Admin
const getTeacherCredentials = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, d.file_name, d.file_type, d.ocr_extracted_text
       FROM credentials c
       JOIN documents d ON c.document_id = d.id
       WHERE c.teacher_id = $1
       ORDER BY c.created_at DESC`,
      [req.params.teacherId]
    );

    res.json({ count: result.rows.length, credentials: result.rows });

  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/credentials/nodes
// @access HR Officer, Admin
const getBlockchainNodes = async (req, res) => {
  try {
    const status = await getNetworkStatus();
    res.json({ consensus: 'PBFT (Majority Endorsement)', ...status });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/credentials/verified-teachers
// @access HR Officer, Admin
// Read-only list — HR doesn't upload or review anything here, verification
// already happened automatically when each teacher uploaded their document.
const getVerifiedTeachers = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         t.id AS teacher_id, t.first_name, t.last_name, t.staff_id,
         t.current_school, t.current_district, t.current_region,
         d.id AS document_id, d.file_name, d.uploaded_at,
         c.verification_status, c.verified_at, c.blockchain_tx_id, c.document_hash
       FROM credentials c
       JOIN teachers t ON c.teacher_id = t.id
       JOIN documents d ON c.document_id = d.id
       WHERE c.verification_status = 'verified'
       ORDER BY c.verified_at DESC`
    );

    res.json({ count: result.rows.length, teachers: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = {
  getMyCredentials,
  verifyCredentialByTxId,
  getTeacherCredentials,
  getVerifiedTeachers,
  getBlockchainNodes
};