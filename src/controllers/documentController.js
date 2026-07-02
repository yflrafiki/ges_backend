const pool = require('../config/db');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
  extractTextFromFile,
  parseDocumentFields,
  validateAgainstTeacherRecord
} = require('../services/ocrService');
const { anchorDocumentHash, verifyOnChain } = require('../services/blockchainVerifyService');
const minio = require('../services/minioService');

// SHA-256 hash of a file on disk
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
    const allowedTypes = ['qualification', 'license', 'other'];
    const document_type = allowedTypes.includes(req.body.document_type) ? req.body.document_type : 'other';

    const teacherResult = await pool.query(
      'SELECT id, staff_id, first_name, last_name FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found' });
    }

    const teacher    = teacherResult.rows[0];
    const teacher_id = teacher.id;
    const staff_id   = teacher.staff_id;
    const teacherName = `${teacher.first_name} ${teacher.last_name}`;

    // Hash the file while it's still on disk (multer wrote it there)
    const fileHash = await generateFileHash(req.file.path);

    // Upload to MinIO — object name is the filename multer generated
    const objectName = minio.toObjectName(req.file.filename);
    await minio.uploadFromPath(minio.BUCKETS.DOCUMENTS, objectName, req.file.path, req.file.mimetype);

    // Delete the local temp file — MinIO is the source of truth now
    fs.unlink(req.file.path, (err) => {
      if (err) console.warn(`[MinIO] Could not delete temp file ${req.file.path}:`, err.message);
    });

    const docResult = await pool.query(
      `INSERT INTO documents
        (teacher_id, application_id, file_name, file_path, file_type,
         ocr_status, document_hash, document_type)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
       RETURNING *`,
      [
        teacher_id,
        application_id || null,
        req.file.originalname,
        objectName,          // MinIO object name, not a local path
        req.file.mimetype,
        fileHash,
        document_type
      ]
    );

    const document = docResult.rows[0];

    res.status(201).json({
      message: 'Document uploaded successfully. OCR processing started.',
      document: {
        id:           document.id,
        file_name:    document.file_name,
        file_type:    document.file_type,
        document_type: document.document_type,
        ocr_status:   document.ocr_status,
        uploaded_at:  document.uploaded_at
      }
    });

    // Background: anchor hash → OCR → cross-check against GTEC/NTC
    processDocumentVerification(
      document.id, objectName, teacher_id, staff_id, teacherName,
      fileHash, document.file_name, document_type
    );

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Background processing:
//   1. Anchor the document hash on the blockchain (tamper-evidence).
//   2. Download from MinIO to a temp file for OCR, then delete temp.
//   3. For qualification/license docs, cross-check against GTEC/NTC on-chain.
const processDocumentVerification = async (
  documentId, objectName, teacherId, staffId, teacherName,
  fileHash, fileName, documentType = 'other'
) => {
  let anchorResult;
  try {
    console.log(`\n=== Anchoring document hash on blockchain: ${documentId} ===`);
    anchorResult = await anchorDocumentHash(fileHash, staffId, fileName);
    console.log(`Anchored (${anchorResult.mode}): ${anchorResult.txId || 'n/a'}`);
  } catch (err) {
    console.error('Blockchain anchoring error:', err);
    anchorResult = { anchored: false, mode: 'error', txId: null };
  }

  // Download from MinIO to a temp file for OCR (Tesseract needs a file path)
  const tempPath = path.join(require('os').tmpdir(), `ges_ocr_${documentId}_${fileName}`);
  let ocrFilePath = null;
  try {
    const stream = await minio.getFileStream(minio.BUCKETS.DOCUMENTS, objectName);
    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(tempPath);
      stream.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    ocrFilePath = tempPath;
  } catch (err) {
    console.error('Failed to download from MinIO for OCR:', err.message);
  }

  try {
    console.log(`=== OCR Processing: Document ${documentId} ===`);

    const ocrResult = ocrFilePath
      ? await extractTextFromFile(ocrFilePath)
      : { success: false, error: 'File unavailable for OCR' };

    if (ocrResult.success && ocrResult.text) {
      const parsedFields = parseDocumentFields(ocrResult.text);
      const validation   = await validateAgainstTeacherRecord(teacherId, parsedFields);

      let blockchainCheck = null;
      if (documentType === 'qualification' || documentType === 'license') {
        try {
          blockchainCheck = await verifyOnChain(documentType, staffId, teacherName, parsedFields);
          console.log(`On-chain credential check (${documentType}):`, blockchainCheck.result, blockchainCheck.message);
        } catch (err) {
          console.error('On-chain credential check error:', err.message);
          blockchainCheck = { found: false, result: 'error', message: err.message };
        }
      }

      const blockchainOk = !blockchainCheck || blockchainCheck.result === 'match';
      const verified = anchorResult.anchored && validation.nameMatch && validation.staffIdMatch && blockchainOk;

      const details = [
        anchorResult.anchored
          ? `✓ BLOCKCHAIN (${anchorResult.mode}): Document hash anchored — tamper-proof record created`
          : `✗ BLOCKCHAIN: Failed to anchor document hash`,
        ...validation.details,
        ...(blockchainCheck
          ? [blockchainOk
              ? `✓ BLOCKCHAIN: Credential matches GTEC/NTC's anchored record`
              : `✗ BLOCKCHAIN: Credential check returned "${blockchainCheck.result}" — ${blockchainCheck.message}`]
          : [])
      ];

      const validationSummary = JSON.stringify({
        nameMatch:        validation.nameMatch,
        staffIdMatch:     validation.staffIdMatch,
        blockchainAnchor: anchorResult,
        blockchainCheck,
        verified,
        details,
        parsedFields: {
          name:          parsedFields.name          || null,
          staffId:       parsedFields.staffId       || null,
          institution:   parsedFields.institution   || null,
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

      await pool.query(
        `INSERT INTO credentials
          (teacher_id, document_id, document_hash, blockchain_tx_id, verification_status, verified_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (document_id) DO UPDATE SET
           document_hash        = $3,
           blockchain_tx_id     = $4,
           verification_status  = $5,
           verified_at          = $6`,
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
  } finally {
    // Clean up the temp OCR file
    if (ocrFilePath) {
      fs.unlink(ocrFilePath, () => {});
    }
  }
};

// @route  GET /api/documents/my
// @access Teacher only
const getMyDocuments = async (req, res) => {
  try {
    const teacherResult = await pool.query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
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
      const teacher = await pool.query('SELECT id FROM teachers WHERE user_id = $1', [req.user.id]);
      if (doc.teacher_id !== teacher.rows[0].id) {
        return res.status(403).json({ message: 'Not authorized' });
      }
    }

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
// Streams the raw file from MinIO through this authenticated endpoint.
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

    const objectName = doc.file_path; // stored as MinIO object name

    let stat;
    try {
      stat = await minio.statObject(minio.BUCKETS.DOCUMENTS, objectName);
    } catch (err) {
      return res.status(404).json({ message: 'File not found in storage' });
    }

    res.setHeader('Content-Type', stat.metaData?.['content-type'] || doc.file_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${doc.file_name}"`);
    if (stat.size) res.setHeader('Content-Length', stat.size);

    const stream = await minio.getFileStream(minio.BUCKETS.DOCUMENTS, objectName);
    stream.on('error', (err) => {
      console.error('MinIO stream error:', err.message);
      if (!res.headersSent) res.status(500).json({ message: 'Error streaming file' });
    });
    stream.pipe(res);

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
