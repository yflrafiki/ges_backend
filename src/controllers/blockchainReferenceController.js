const pool = require('../config/db');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { extractTextFromFile, parseDocumentFields } = require('../services/ocrService');
const { verifyAgainstReference } = require('../services/blockchainVerifyService');

const generateHash = (data) => {
  return crypto.createHash('sha256').update(data).digest('hex');
};

const generateTxId = () => {
  const timestamp = Date.now().toString(16).toUpperCase();
  const random = crypto.randomBytes(16).toString('hex').toUpperCase();
  return `${timestamp}${random}`;
};

// Simulate storing on blockchain nodes
const anchorToNodes = async (data) => {
  const nodes = [
    { id: 'GES', role: 'orderer', msp: 'GESMSP' },
    { id: 'GTEC', role: 'peer', msp: 'GTECMSP' },
    { id: 'NTC', role: 'peer', msp: 'NTCMSP' },
  ];

  console.log(`\n=== ANCHORING TO BLOCKCHAIN ===`);
  for (const node of nodes) {
    await new Promise(r => setTimeout(r, 200));
    console.log(`[${node.role.toUpperCase()}] ${node.id} (${node.msp}): endorsed`);
  }
  console.log(`Consensus: 3/3 nodes — COMMITTED ✓`);
  console.log(`===============================\n`);
  return nodes;
};

// @route  POST /api/blockchain/upload-reference
// @access Admin, HR Officer
const uploadReference = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { staff_id, teacher_name, document_type, issued_by, issued_date } = req.body;

    if (!staff_id || !teacher_name || !document_type) {
      return res.status(400).json({
        message: 'staff_id, teacher_name and document_type are required'
      });
    }

    // Generate hash from file content
    const fileBuffer = fs.readFileSync(req.file.path);
    const documentHash = generateHash(fileBuffer);
    const txId = generateTxId();

    // Determine which org anchors based on document type
    const orgMsp = document_type === 'degree' || document_type === 'diploma'
      ? 'GTECMSP'
      : document_type === 'teaching_license' || document_type === 'ntc_certificate'
      ? 'NTCMSP'
      : 'GESMSP';

    // Anchor to blockchain nodes
    await anchorToNodes({ staff_id, teacher_name, documentHash, orgMsp });

    // Save to database
    const result = await pool.query(
      `INSERT INTO blockchain_references
        (staff_id, teacher_name, document_type, document_hash,
         blockchain_tx_id, org_msp, issued_by, issued_date, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        staff_id.toUpperCase(),
        teacher_name.toUpperCase(),
        document_type,
        documentHash,
        txId,
        orgMsp,
        issued_by || null,
        issued_date || null,
        req.user.id
      ]
    );

    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'BLOCKCHAIN_REFERENCE_UPLOAD', 'blockchain_references',
        result.rows[0].id,
        `Reference uploaded for ${teacher_name} (${staff_id}). Type: ${document_type}. TX: ${txId}`]
    );

    res.status(201).json({
      message: 'Document anchored to blockchain successfully',
      reference: result.rows[0],
      blockchain: {
        transaction_id: txId,
        document_hash: documentHash,
        org_msp: orgMsp,
        nodes_confirmed: 3,
        consensus: '3/3'
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/blockchain/references
// @access Admin, HR Officer
const getAllReferences = async (req, res) => {
  try {
    const { staff_id } = req.query;
    let query = `
      SELECT br.*, u.email as uploaded_by_email
      FROM blockchain_references br
      LEFT JOIN users u ON br.uploaded_by = u.id
      WHERE 1=1
    `;
    const params = [];

    if (staff_id) {
      query += ` AND br.staff_id = $1`;
      params.push(staff_id.toUpperCase());
    }

    query += ` ORDER BY br.created_at DESC`;

    const result = await pool.query(query, params);
    res.json({ count: result.rows.length, references: result.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = {
  uploadReference,
  getAllReferences,
  verifyAgainstReference
};