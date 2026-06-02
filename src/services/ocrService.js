const Tesseract = require('tesseract.js');
const mammoth = require('mammoth');
const path = require('path');
const fs = require('fs');
const pool = require('../config/db');
const { verifyAgainstReference } = require('./blockchainVerifyService');

// Extract text based on file type
const extractTextFromFile = async (filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, text: null, error: 'File not found' };
    }

    const ext = path.extname(filePath).toLowerCase();
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];
    const docxExts = ['.docx', '.doc'];
    const pdfExts = ['.pdf'];

    // Handle DOCX files
    if (docxExts.includes(ext)) {
      return await extractFromDocx(filePath);
    }

    // Handle PDF files
    if (pdfExts.includes(ext)) {
      return await extractFromPdf(filePath);
    }

    // Handle image files with Tesseract OCR
    if (imageExts.includes(ext)) {
      return await extractFromImage(filePath);
    }

    // Unknown file type — return filename as text
    return {
      success: true,
      text: `[Document: ${path.basename(filePath)}]`,
      confidence: 0,
      isImage: false
    };

  } catch (err) {
    console.error('Text extraction error:', err);
    return { success: false, text: null, error: err.message };
  }
};

// Extract text from DOCX using mammoth
const extractFromDocx = async (filePath) => {
  try {
    console.log('Extracting text from DOCX:', path.basename(filePath));
    const result = await mammoth.extractRawText({ path: filePath });
    const text = result.value.trim();

    if (result.messages.length > 0) {
      console.log('Mammoth warnings:', result.messages);
    }

    console.log(`DOCX extraction complete. Characters: ${text.length}`);
    return {
      success: true,
      text: text || '[Empty document]',
      confidence: 100,
      isImage: false,
      method: 'docx'
    };
  } catch (err) {
    console.error('DOCX extraction error:', err);
    return { success: false, text: null, error: err.message };
  }
};

// Extract text from PDF
const extractFromPdf = async (filePath) => {
  try {
    console.log('Processing PDF:', path.basename(filePath));
    // For PDFs we use Tesseract on the file directly
    // Tesseract can handle some PDFs
    const result = await Tesseract.recognize(filePath, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          process.stdout.write(`\rPDF OCR Progress: ${Math.round(m.progress * 100)}%`);
        }
      }
    });
    console.log('\nPDF processing complete');
    return {
      success: true,
      text: result.data.text.trim() || '[No text extracted from PDF]',
      confidence: result.data.confidence,
      isImage: false,
      method: 'pdf_ocr'
    };
  } catch (err) {
    console.error('PDF extraction error:', err);
    // Return empty but successful so the document is still saved
    return {
      success: true,
      text: '[PDF document — text extraction not available]',
      confidence: 0,
      isImage: false,
      method: 'pdf_fallback'
    };
  }
};

// Extract text from image using Tesseract OCR
const extractFromImage = async (filePath) => {
  try {
    console.log('Starting OCR on image:', path.basename(filePath));
    const result = await Tesseract.recognize(filePath, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          process.stdout.write(`\rOCR Progress: ${Math.round(m.progress * 100)}%`);
        }
      }
    });
    console.log('\nImage OCR complete');
    return {
      success: true,
      text: result.data.text.trim(),
      confidence: result.data.confidence,
      isImage: true,
      method: 'tesseract'
    };
  } catch (err) {
    console.error('Image OCR error:', err);
    return { success: false, text: null, error: err.message };
  }
};

// Parse key fields from extracted text
const parseDocumentFields = (text) => {
  const fields = {};

  // Name patterns
  const namePatterns = [
    /(?:NAME|THIS IS TO CERTIFY THAT|AWARDED TO|PRESENTED TO|CERTIFY THAT)[:\s]+([A-Z][A-Z\s]{2,40})/i,
    /(?:MR|MRS|MS|DR|PROF)\.?\s+([A-Z][A-Z\s]{2,30})/i,
    /(?:STUDENT|EMPLOYEE|STAFF)\s+(?:NAME)?[:\s]+([A-Z][A-Z\s]{2,30})/i,
  ];
  for (const pattern of namePatterns) {
  const match = text.match(pattern);
  if (match && match[1].trim().length > 2) {
    // Clean name — remove newlines and extra spaces, take only first line
    const cleanName = match[1]
      .split(/[\n\r]/)[0]  // take only first line
      .trim()
      .replace(/\s+/g, ' '); // normalize spaces
    if (cleanName.length > 2) {
      fields.name = cleanName;
      break;
    }
  }
}

  // Staff ID patterns
  const idPatterns = [
    /(?:STAFF\s*ID|EMPLOYEE\s*ID|ID\s*NO|ID\s*NUMBER|STAFF\s*NO)[:\s#]+([A-Z0-9\-\/]+)/i,
    /(?:GES)[\/\-\s]?([0-9]{3,})/i,
    /(?:REG(?:ISTRATION)?\s*(?:NO|NUMBER))[:\s]+([A-Z0-9\-]+)/i,
    /(?:STAFF)[:\s]+([A-Z]{2,}[0-9]{3,})/i,
  ];
  for (const pattern of idPatterns) {
    const match = text.match(pattern);
    if (match) {
      fields.staffId = match[1].trim();
      break;
    }
  }

  // Fallback name extraction from labeled lines
  if (!fields.name) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const lineNameMatch = line.match(/(?:name|employee|staff)\s*[:\-]\s*([A-Za-z][A-Za-z\s]{2,60})/i);
      if (lineNameMatch && lineNameMatch[1].trim().length > 2) {
        fields.name = lineNameMatch[1].trim().replace(/\s+/g, ' ');
        break;
      }
    }
  }

  // Fallback staff ID extraction from labeled lines
  if (!fields.staffId) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const lineIdMatch = line.match(/(?:staff\s*id|employee\s*id|id\s*(?:no|number)|staff)\s*[:#\-]?\s*([A-Z0-9\-\/]+)/i);
      if (lineIdMatch && lineIdMatch[1]) {
        fields.staffId = lineIdMatch[1].trim();
        break;
      }
    }
  }

  // Institution
  const institutionPattern = /(?:UNIVERSITY|COLLEGE|INSTITUTE|SCHOOL|POLYTECHNIC|COMMISSION|COUNCIL|EDUCATION)[^\n\r]{0,80}/gi;
  const institutions = text.match(institutionPattern);
  if (institutions) fields.institution = institutions[0].trim();

  // Qualification
  const qualPattern = /(?:BACHELOR|MASTER|DOCTOR|DIPLOMA|CERTIFICATE|DEGREE|B\.ED|M\.ED|PHD|B\.SC|M\.SC|B\.A|M\.A)[^\n\r]{0,60}/gi;
  const quals = text.match(qualPattern);
  if (quals) fields.qualification = quals[0].trim();

  // Dates
  const datePattern = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4})\b/g;
  const dates = text.match(datePattern);
  if (dates) fields.dates = [...new Set(dates)].slice(0, 5);

  return fields;
};

// Validate OCR fields against teacher DB record
const validateAgainstTeacherRecord = async (teacherId, parsedFields, documentHash) => {
  try {
    const result = await pool.query(
      'SELECT first_name, last_name, staff_id FROM teachers WHERE id = $1',
      [teacherId]
    );

    if (result.rows.length === 0) {
      return { valid: false, reason: 'Teacher not found' };
    }

    const teacher = result.rows[0];
    const fullName = `${teacher.first_name} ${teacher.last_name}`.toUpperCase();
    const firstName = teacher.first_name.toUpperCase();
    const lastName = teacher.last_name.toUpperCase();
    const staffId = teacher.staff_id.toUpperCase();

    const validationResults = {
      nameMatch: false,
      staffIdMatch: false,
      details: [],
      blockchainCheck: null
    };

    // Name validation
    if (parsedFields.name) {
      const extractedName = parsedFields.name.toUpperCase().trim();
      if (
        fullName.includes(extractedName) ||
        extractedName.includes(firstName) ||
        extractedName.includes(lastName) ||
        extractedName.includes(fullName)
      ) {
        validationResults.nameMatch = true;
        validationResults.details.push(`✓ Name matched: "${parsedFields.name}"`);
      } else {
        validationResults.details.push(
          `✗ Name mismatch: Document "${parsedFields.name}" vs Profile "${fullName}"`
        );
      }
    } else {
      validationResults.details.push('⚠ No name detected in document');
    }

    // Staff ID validation
    if (parsedFields.staffId) {
      const extractedId = parsedFields.staffId.toUpperCase().trim();
      if (staffId.includes(extractedId) || extractedId.includes(staffId)) {
        validationResults.staffIdMatch = true;
        validationResults.details.push(`✓ Staff ID matched: "${parsedFields.staffId}"`);
      } else {
        validationResults.details.push(
          `✗ Staff ID mismatch: Document "${parsedFields.staffId}" vs Profile "${staffId}"`
        );
      }
    } else {
      validationResults.details.push('⚠ No Staff ID detected in document');
    }

    // Blockchain reference check
    console.log(`Checking blockchain references for staff: ${staffId}`);
    const blockchainResult = await verifyAgainstReference(staffId, fullName, documentHash);
    validationResults.blockchainCheck = blockchainResult;

    if (blockchainResult.found) {
      if (blockchainResult.hashMatch) {
        validationResults.details.push(`✓ BLOCKCHAIN: Exact document match found on ledger`);
      } else if (blockchainResult.nameMatch) {
        validationResults.details.push(`✓ BLOCKCHAIN: Teacher name verified against blockchain reference`);
      } else {
        validationResults.details.push(`⚠ BLOCKCHAIN: Document does not match reference on ledger`);
      }
    } else {
      validationResults.details.push(`⚠ BLOCKCHAIN: No reference documents found for this teacher`);
    }

    return {
      valid: validationResults.nameMatch || validationResults.staffIdMatch,
      nameMatch: validationResults.nameMatch,
      staffIdMatch: validationResults.staffIdMatch,
      blockchainCheck: blockchainResult,
      details: validationResults.details,
      teacherRecord: { name: fullName, staffId }
    };

  } catch (err) {
    console.error('Validation error:', err);
    return { valid: false, reason: err.message };
  }
};

module.exports = {
  extractTextFromFile,
  parseDocumentFields,
  validateAgainstTeacherRecord
};