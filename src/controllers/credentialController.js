const pool = require('../config/db');
const {
  submitToBlockchain,
  verifyOnBlockchain,
  generateDocumentHash,
  BLOCKCHAIN_NODES
} = require('../services/blockchainService');

// @route  POST /api/credentials/verify/:documentId
// @access Teacher only
const submitForVerification = async (req, res) => {
  try {
    const { documentId } = req.params;

    const docResult = await pool.query(
      'SELECT * FROM documents WHERE id = $1',
      [documentId]
    );

    if (docResult.rows.length === 0) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const document = docResult.rows[0];

    const teacherResult = await pool.query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found' });
    }

    if (document.teacher_id !== teacherResult.rows[0].id) {
      return res.status(403).json({ message: 'Not authorized to verify this document' });
    }

    if (document.ocr_status !== 'completed') {
      return res.status(400).json({
        message: `OCR status is '${document.ocr_status}'. OCR must complete before verification.`
      });
    }

    const existing = await pool.query(
      `SELECT * FROM credentials 
       WHERE document_id = $1 AND verification_status = 'verified'`,
      [documentId]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        message: 'Document already verified on blockchain',
        credential: existing.rows[0]
      });
    }

    // Respond immediately
    res.json({
      message: 'Submitted to blockchain. Verification in progress.',
      document_id: documentId,
      status: 'processing',
      nodes: BLOCKCHAIN_NODES.map(n => ({ ...n, status: 'pending' }))
    });

    // Process in background
    processBlockchainVerification(document, teacherResult.rows[0].id, req.user.id);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Background blockchain processing — Flow 1 (Anchoring)
const processBlockchainVerification = async (document, teacher_id, user_id) => {
  try {
    console.log(`\nStarting blockchain anchoring for document: ${document.id}`);

    // Generate hash from OCR text (the actual content)
    const documentHash = generateDocumentHash(
      document.ocr_extracted_text || document.file_name
    );

    const blockchainResult = await submitToBlockchain({
      teacher_id,
      document_id: document.id,
      file_name: document.file_name,
      ocr_text: document.ocr_extracted_text,
      cert_type: 'qualification', // GTEC anchors qualifications
      timestamp: new Date().toISOString()
    });

    if (blockchainResult.success) {
      await pool.query(
        `INSERT INTO credentials
          (teacher_id, document_id, document_hash, blockchain_tx_id,
           verification_status, verified_at)
         VALUES ($1, $2, $3, $4, 'verified', NOW())
         ON CONFLICT (document_id) DO UPDATE SET
           document_hash = $3,
           blockchain_tx_id = $4,
           verification_status = 'verified',
           verified_at = NOW()`,
        [
          teacher_id,
          document.id,
          blockchainResult.document_hash,
          blockchainResult.transaction_id
        ]
      );

      await pool.query(
        `INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          user_id,
          'BLOCKCHAIN_ANCHOR',
          'credentials',
          document.id,
          `Document anchored on blockchain. TX: ${blockchainResult.transaction_id}. Consensus: ${blockchainResult.consensus}`
        ]
      );

      console.log(`✓ Document ${document.id} anchored. TX: ${blockchainResult.transaction_id}`);

    } else {
      await pool.query(
        `INSERT INTO credentials (teacher_id, document_id, verification_status)
         VALUES ($1, $2, 'failed')
         ON CONFLICT (document_id) DO UPDATE SET verification_status = 'failed'`,
        [teacher_id, document.id]
      );
      console.log(`✗ Blockchain anchoring failed for document ${document.id}`);
    }

  } catch (err) {
    console.error('Blockchain processing error:', err);
  }
};

// @route  GET /api/credentials/my
// @access Teacher only
const getMyCredentials = async (req, res) => {
  try {
    const teacherResult = await pool.query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
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
  res.json({
    network: 'Hyperledger Fabric (Private)',
    channel: 'ges-channel',
    chaincode: 'ges-verify',
    consensus: 'PBFT',
    nodes: BLOCKCHAIN_NODES
  });
};

module.exports = {
  submitForVerification,
  getMyCredentials,
  verifyCredentialByTxId,
  getTeacherCredentials,
  getBlockchainNodes
};