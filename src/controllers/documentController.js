const pool = require('../config/db');
const path = require('path');
const fs = require('fs');
const { extractTextFromFile, parseDocumentFields } = require('../services/ocrService');

const isOCREligible = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'].includes(ext);
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

    // Save document record as pending
    const docResult = await pool.query(
      `INSERT INTO documents
        (teacher_id, application_id, file_name, file_path, file_type, ocr_status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING *`,
      [
        teacher_id,
        application_id || null,
        req.file.originalname,
        req.file.path,
        req.file.mimetype
      ]
    );

    const document = docResult.rows[0];

    // Run OCR in background
    res.status(201).json({
      message: 'File uploaded successfully. OCR processing started.',
      document: {
        id: document.id,
        file_name: document.file_name,
        file_type: document.file_type,
        ocr_status: document.ocr_status,
        uploaded_at: document.uploaded_at
      }
    });

    // Process OCR after response is sent
    processOCR(document.id, req.file.path);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Background OCR processing
const processOCR = async (documentId, filePath) => {
  try {
    if (!isOCREligible(filePath)) {
      console.log(`Skipping OCR for unsupported file type: ${filePath}`);
      await pool.query(
        `UPDATE documents SET ocr_status = 'failed' WHERE id = $1`,
        [documentId]
      );
      return;
    }

    const ocrResult = await extractTextFromFile(filePath);

    if (ocrResult.success) {
      await pool.query(
        `UPDATE documents SET
          ocr_extracted_text = $1,
          ocr_status = 'completed'
         WHERE id = $2`,
        [ocrResult.text, documentId]
      );
      console.log(`OCR completed for document ${documentId}`);
    } else {
      await pool.query(
        `UPDATE documents SET ocr_status = 'failed' WHERE id = $1`,
        [documentId]
      );
      console.log(`OCR failed for document ${documentId}`);
    }
  } catch (err) {
    console.error('Background OCR error:', err);
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
        ocr_extracted_text, application_id, uploaded_at
       FROM documents
       WHERE teacher_id = $1
       ORDER BY uploaded_at DESC`,
      [teacherResult.rows[0].id]
    );

    res.json({
      count: result.rows.length,
      documents: result.rows
    });

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

    // Teacher can only see their own documents
    if (req.user.role === 'teacher') {
      const teacher = await pool.query(
        'SELECT id FROM teachers WHERE user_id = $1',
        [req.user.id]
      );
      if (doc.teacher_id !== teacher.rows[0].id) {
        return res.status(403).json({ message: 'Not authorized to view this document' });
      }
    }

    // Parse OCR fields if text is available
    let parsedFields = null;
    if (doc.ocr_extracted_text) {
      parsedFields = parseDocumentFields(doc.ocr_extracted_text);
    }

    res.json({
      document: doc,
      parsed_fields: parsedFields
    });

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
        ocr_extracted_text, application_id, uploaded_at
       FROM documents
       WHERE teacher_id = $1
       ORDER BY uploaded_at DESC`,
      [req.params.teacherId]
    );

    res.json({
      count: result.rows.length,
      documents: result.rows
    });

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