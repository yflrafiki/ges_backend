const pool = require('../config/db');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
  extractTextFromFile,
  parseDocumentFields,
  validateAgainstTeacherRecord
} = require('../services/ocrService');
const { anchorDocumentHash } = require('../services/blockchainVerifyService');

// Generate SHA-256 hash of file
const generateFileHash = (filePath) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
};

// @route  POST /api/documents/upload
// @access Teacher only
const uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { application_id } = req.body;

    // Get teacher profile
    const teacherResult = await pool.query(
      'SELECT id, staff_id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found' });
    }

    const teacher_id = teacherResult.rows[0].id;
    const staff_id = teacherResult.rows[0].staff_id;

    // Generate hash of the uploaded file immediately
    const fileHash = await generateFileHash(req.file.path);
    console.log(`Document hash generated: ${fileHash}`);

    // Save relative path
    const relativePath = `uploads/documents/${req.file.filename}`;

    // Save document record
    const docResult = await pool.query(
      `INSERT INTO documents
        (teacher_id, application_id, file_name, file_path, file_type,
         ocr_status, document_hash)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)
       RETURNING *`,
      [
        teacher_id,
        application_id || null,
        req.file.originalname,
        relativePath,
        req.file.mimetype,
        fileHash
      ]
    );

    const document = docResult.rows[0];

    // Respond immediately
    res.status(201).json({
      message: 'Document uploaded successfully. OCR processing started.',
      document: {
        id: document.id,
        file_name: document.file_name,
        file_type: document.file_type,
        ocr_status: document.ocr_status,
        uploaded_at: document.uploaded_at
      }
    });

    // Process in background: anchor the hash on the blockchain first (this is
    // the authenticity check), then run OCR to validate name/staff ID.
    processDocumentVerification(document.id, req.file.path, teacher_id, staff_id, fileHash, document.file_name);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Background processing — fully automatic, no teacher action required:
//   1. Anchor the document hash on the blockchain FIRST. This is the
//      authenticity check — the hash becoming an immutable ledger record is
//      what "verified" means here, not a check against some pre-existing
//      reference GTEC/NTC uploaded.
//   2. THEN run OCR to check the document's name/staff ID against the
//      teacher's profile.
//   3. A document is "verified" only if both the anchor succeeded and the
//      OCR fields match — this automatically creates/updates the teacher's
//      credentials row, so neither the teacher nor HR has to do anything.
const processDocumentVerification = async (documentId, filePath, teacherId, staffId, fileHash, fileName) => {
  let anchorResult;
  try {
    console.log(`\n=== Anchoring document hash on blockchain: ${documentId} ===`);
    anchorResult = await anchorDocumentHash(fileHash, staffId, fileName);
    console.log(`Anchored (${anchorResult.mode}): ${anchorResult.txId || 'n/a'}`);
  } catch (err) {
    console.error('Blockchain anchoring error:', err);
    anchorResult = { anchored: false, mode: 'error', txId: null };
  }

  try {
    console.log(`=== OCR Processing: Document ${documentId} ===`);

    const ocrResult = await extractTextFromFile(filePath);

    if (ocrResult.success && ocrResult.text) {
      const parsedFields = parseDocumentFields(ocrResult.text);
      console.log('Parsed fields:', parsedFields);

      const validation = await validateAgainstTeacherRecord(teacherId, parsedFields);
      console.log('Validation result:', validation);

      const verified = anchorResult.anchored && validation.nameMatch && validation.staffIdMatch;

      const details = [
        anchorResult.anchored
          ? `✓ BLOCKCHAIN (${anchorResult.mode}): Document hash anchored — tamper-proof record created`
          : `✗ BLOCKCHAIN: Failed to anchor document hash`,
        ...validation.details
      ];

      const validationSummary = JSON.stringify({
        nameMatch: validation.nameMatch,
        staffIdMatch: validation.staffIdMatch,
        blockchainAnchor: anchorResult,
        verified,
        details,
        parsedFields: {
          name: parsedFields.name || null,
          staffId: parsedFields.staffId || null,
          institution: parsedFields.institution || null,
          qualification: parsedFields.qualification || null,
        }
      });

      await pool.query(
        `UPDATE documents SET
          ocr_extracted_text = $1,
          ocr_status = 'completed',
          ocr_validation = $2
         WHERE id = $3`,
        [ocrResult.text, validationSummary, documentId]
      );

      // Automatically record the verification outcome — no manual "verify" step.
      await pool.query(
        `INSERT INTO credentials
          (teacher_id, document_id, document_hash, blockchain_tx_id, verification_status, verified_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (document_id) DO UPDATE SET
           document_hash = $3,
           blockchain_tx_id = $4,
           verification_status = $5,
           verified_at = $6`,
        [
          teacherId,
          documentId,
          fileHash,
          anchorResult.txId,
          verified ? 'verified' : 'failed',
          verified ? new Date() : null
        ]
      );

      console.log(`Document ${documentId}: ${verified ? 'VERIFIED' : 'NOT VERIFIED'}`);
      details.forEach(d => console.log(` ${d}`));

    } else {
      await pool.query(`UPDATE documents SET ocr_status = 'failed' WHERE id = $1`, [documentId]);
      await pool.query(
        `INSERT INTO credentials (teacher_id, document_id, document_hash, blockchain_tx_id, verification_status)
         VALUES ($1, $2, $3, $4, 'failed')
         ON CONFLICT (document_id) DO UPDATE SET verification_status = 'failed'`,
        [teacherId, documentId, fileHash, anchorResult.txId]
      );
      console.log(`OCR failed for document ${documentId}: ${ocrResult.error}`);
    }

  } catch (err) {
    console.error('OCR processing error:', err);
    await pool.query(`UPDATE documents SET ocr_status = 'failed' WHERE id = $1`, [documentId]);
  }
};

// @route  GET /api/documents/my
// @access Teacher only
const getMyDocuments = async (req, res) => {
  try {
    console.log('GET /api/documents/my for user', req.user.id);
    const teacherResult = await pool.query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      console.warn('Teacher profile not found for user', req.user.id);
      return res.status(404).json({ message: 'Teacher profile not found' });
    }

    const result = await pool.query(
      `SELECT id, file_name, file_type, ocr_status,
        ocr_extracted_text, ocr_validation,
        application_id, uploaded_at
       FROM documents
       WHERE teacher_id = $1
       ORDER BY uploaded_at DESC`,
      [teacherResult.rows[0].id]
    );

    res.json({ count: result.rows.length, documents: result.rows });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/documents/:id
// @access Teacher (own), HR Officer, Admin
const getDocumentById = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.*, t.first_name, t.last_name, t.staff_id
       FROM documents d
       JOIN teachers t ON d.teacher_id = t.id
       WHERE d.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const doc = result.rows[0];

    if (req.user.role === 'teacher') {
      const teacher = await pool.query(
        'SELECT id FROM teachers WHERE user_id = $1',
        [req.user.id]
      );
      if (doc.teacher_id !== teacher.rows[0].id) {
        return res.status(403).json({ message: 'Not authorized' });
      }
    }

    // Parse validation JSON
    let validation = null;
    if (doc.ocr_validation) {
      try { validation = JSON.parse(doc.ocr_validation); } catch (e) {}
    }

    const documentResponse = { ...doc };
    delete documentResponse.document_hash;
    delete documentResponse.file_path;

    res.json({ document: documentResponse, validation });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/documents/:id/file
// @access Teacher (own), HR Officer, Admin
// Streams the raw uploaded file. This is the ONLY way to fetch a document's
// content — the uploads/documents folder is intentionally not publicly served,
// so every download goes through this authorization check.
const getDocumentFile = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const doc = result.rows[0];

    if (req.user.role === 'teacher') {
      const teacher = await pool.query('SELECT id FROM teachers WHERE user_id = $1', [req.user.id]);
      if (doc.teacher_id !== teacher.rows[0]?.id) {
        return res.status(403).json({ message: 'Not authorized' });
      }
    }

    const absolutePath = path.join(__dirname, '..', doc.file_path);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ message: 'File not found on disk' });
    }

    res.sendFile(absolutePath, { headers: { 'Content-Disposition': `inline; filename="${doc.file_name}"` } });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/documents/teacher/:teacherId
// @access HR Officer, Admin
const getTeacherDocuments = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, file_name, file_type, ocr_status,
        ocr_extracted_text, ocr_validation, uploaded_at
       FROM documents
       WHERE teacher_id = $1
       ORDER BY uploaded_at DESC`,
      [req.params.teacherId]
    );

    res.json({ count: result.rows.length, documents: result.rows });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = {
  uploadDocument,
  getMyDocuments,
  getDocumentById,
  getDocumentFile,
  getTeacherDocuments
};