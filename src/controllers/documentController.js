const pool = require('../config/db');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
  extractTextFromFile,
  parseDocumentFields,
  validateAgainstTeacherRecord
} = require('../services/ocrService');

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
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found' });
    }

    const teacher_id = teacherResult.rows[0].id;

    // Generate hash of the uploaded file immediately
    const fileHash = await generateFileHash(req.file.path);
    console.log(`Document hash generated: ${fileHash}`);

    // Save relative path
    const relativePath = `uploads/${req.file.filename}`;

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
        document_hash: document.document_hash,
        uploaded_at: document.uploaded_at
      }
    });

    // Process OCR in background
    processOCR(document.id, req.file.path, teacher_id, fileHash);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Background OCR processing with validation
const processOCR = async (documentId, filePath, teacherId, fileHash) => {
  try {
    console.log(`\n=== OCR Processing: Document ${documentId} ===`);

    // Extract text
    const ocrResult = await extractTextFromFile(filePath);

    if (ocrResult.success && ocrResult.text) {
      // Parse key fields from extracted text
      const parsedFields = parseDocumentFields(ocrResult.text);
      console.log('Parsed fields:', parsedFields);

      // Validate against teacher record in database
      const validation = await validateAgainstTeacherRecord(teacherId, parsedFields, fileHash);
      console.log('Validation result:', validation);

      // Build validation summary
      const validationSummary = JSON.stringify({
        nameMatch: validation.nameMatch,
        staffIdMatch: validation.staffIdMatch,
        blockchainCheck: validation.blockchainCheck,
        details: validation.details,
        parsedFields: {
          name: parsedFields.name || null,
          staffId: parsedFields.staffId || null,
          institution: parsedFields.institution || null,
          qualification: parsedFields.qualification || null,
        }
      });

      // Update document with OCR results and validation
      await pool.query(
        `UPDATE documents SET
          ocr_extracted_text = $1,
          ocr_status = 'completed',
          ocr_validation = $2
         WHERE id = $3`,
        [ocrResult.text, validationSummary, documentId]
      );

      console.log(`OCR completed for document ${documentId}`);
      console.log(`Validation: ${validation.valid ? 'PASSED' : 'WARNING'}`);
      validation.details.forEach(d => console.log(` ${d}`));

    } else {
      await pool.query(
        `UPDATE documents SET ocr_status = 'failed' WHERE id = $1`,
        [documentId]
      );
      console.log(`OCR failed for document ${documentId}: ${ocrResult.error}`);
    }

  } catch (err) {
    console.error('OCR processing error:', err);
    await pool.query(
      `UPDATE documents SET ocr_status = 'failed' WHERE id = $1`,
      [documentId]
    );
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
        ocr_extracted_text, ocr_validation, document_hash,
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

    res.json({ document: doc, validation });

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
        ocr_extracted_text, ocr_validation, document_hash, uploaded_at
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
  getTeacherDocuments
};