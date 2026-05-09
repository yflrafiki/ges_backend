const Tesseract = require('tesseract.js');
const path = require('path');

const extractTextFromFile = async (filePath) => {
  try {
    console.log('Starting OCR on:', filePath);

    const result = await Tesseract.recognize(filePath, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    const extractedText = result.data.text.trim();
    console.log('OCR completed successfully');

    return {
      success: true,
      text: extractedText,
      confidence: result.data.confidence
    };

  } catch (err) {
    console.error('OCR error:', err);
    return {
      success: false,
      text: null,
      error: err.message
    };
  }
};

// Parse key fields from extracted text
const parseDocumentFields = (text) => {
  const fields = {};

  // Extract name patterns
  const nameMatch = text.match(/(?:name|student|graduate)[:\s]+([A-Za-z\s]+)/i);
  if (nameMatch) fields.name = nameMatch[1].trim();

  // Extract date patterns
  const dateMatch = text.match(/(?:date|awarded|issued|completed)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\w+ \d{4})/i);
  if (dateMatch) fields.date = dateMatch[1].trim();

  // Extract institution
  const institutionMatch = text.match(/(?:university|college|institute|school|polytechnic)[^\n]*/i);
  if (institutionMatch) fields.institution = institutionMatch[0].trim();

  // Extract qualification/degree
  const qualMatch = text.match(/(?:bachelor|master|doctor|diploma|certificate|degree)[^\n]*/i);
  if (qualMatch) fields.qualification = qualMatch[0].trim();

  return fields;
};

module.exports = { extractTextFromFile, parseDocumentFields };