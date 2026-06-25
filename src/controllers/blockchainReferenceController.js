const pool = require('../config/db');
const crypto = require('crypto');
const fs = require('fs');
const { extractTextFromFile, parseDocumentFields } = require('../services/ocrService');
const { qualCertId, licenseCertId } = require('../services/blockchainVerifyService');
const { invokeChaincodeWithTxId } = require('../services/fabricClient');

const generateHash = (data) => {
  return crypto.createHash('sha256').update(data).digest('hex');
};

const generateTxId = () => {
  const timestamp = Date.now().toString(16).toUpperCase();
  const random = crypto.randomBytes(16).toString('hex').toUpperCase();
  return `${timestamp}${random}`;
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

    // OCR the certificate so we anchor what's actually printed on it, not just
    // what the admin typed — falls back to manual form fields if OCR finds nothing.
    const ocrResult = await extractTextFromFile(req.file.path);
    const ocrFields = ocrResult.success ? parseDocumentFields(ocrResult.text) : {};

    const isQualification = document_type === 'degree' || document_type === 'diploma';
    const isLicense = document_type === 'teaching_license' || document_type === 'ntc_certificate';
    const orgMsp = isQualification ? 'GTECMSP' : isLicense ? 'NTCMSP' : 'GESMSP';

    const staffIdUpper = staff_id.toUpperCase();
    const teacherNameUpper = teacher_name.toUpperCase();
    const certId = isLicense ? licenseCertId(staffIdUpper) : qualCertId(staffIdUpper);

    let anchorOutcome;
    let anchoredOnChain = false;

    if (isQualification || isLicense) {
      try {
        if (isQualification) {
          // GESMSP is required to satisfy the channel's 2-of-3 majority endorsement
          // policy; GTECMSP must also endorse so its peer actually stores the
          // private qualification record (implicit collections are peer-local).
          const { txId } = await invokeChaincodeWithTxId('AnchorQualification', [
            certId,
            teacherNameUpper,
            issued_by || ocrFields.institution || '',
            ocrFields.qualification || document_type,
            '', // fieldOfStudy — not currently OCR-extracted
            issued_date || ''
          ], { endorsingOrganizations: ['GESMSP', 'GTECMSP'] });
          anchorOutcome = { txId, mode: 'fabric' };
        } else {
          const { txId } = await invokeChaincodeWithTxId('AnchorLicense', [
            certId,
            teacherNameUpper,
            req.body.professional_status || '',
            req.body.subject_specialism || '',
            req.body.teaching_level || '',
            issued_date || '',
            req.body.expiry_date || ''
          ], { endorsingOrganizations: ['GESMSP', 'NTCMSP'] });
          anchorOutcome = { txId, mode: 'fabric' };
        }
        anchoredOnChain = true;
      } catch (err) {
        if (/already anchored/i.test(err.message)) {
          return res.status(409).json({
            message: `A ${isLicense ? 'license' : 'qualification'} for staff ID ${staffIdUpper} is already anchored on-chain (certId: ${certId}). Revoke it first if you need to replace it.`,
            certId
          });
        }
        return res.status(502).json({
          message: `Failed to anchor on the blockchain network: ${err.message}`,
        });
      }
    } else {
      // GES-type documents (appointment letters, service records) have no
      // GTEC/NTC chaincode function to anchor into — record the hash only,
      // with no real on-chain transaction.
      anchorOutcome = { txId: generateTxId(), mode: 'hash_only' };
    }

    // Save to database (this is a local index/cache — the source of truth for
    // qualification/license content lives on-chain once anchoredOnChain is true)
    const result = await pool.query(
      `INSERT INTO blockchain_references
        (staff_id, teacher_name, document_type, document_hash,
         blockchain_tx_id, org_msp, issued_by, issued_date, cert_id, anchored_on_chain, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        staffIdUpper,
        teacherNameUpper,
        document_type,
        documentHash,
        anchorOutcome.txId,
        orgMsp,
        issued_by || null,
        issued_date || null,
        (isQualification || isLicense) ? certId : null,
        anchoredOnChain,
        req.user.id
      ]
    );

    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'BLOCKCHAIN_REFERENCE_UPLOAD', 'blockchain_references',
        result.rows[0].id,
        `Reference uploaded for ${teacherNameUpper} (${staffIdUpper}). Type: ${document_type}. Mode: ${anchorOutcome.mode}. TX: ${anchorOutcome.txId}`]
    );

    res.status(201).json({
      message: anchoredOnChain
        ? `Document anchored on the real Fabric network by ${orgMsp.replace('MSP', '')}`
        : 'Document recorded — this document type has no on-chain anchor function, hash recorded locally only',
      reference: result.rows[0],
      blockchain: {
        transaction_id: anchorOutcome.txId,
        document_hash: documentHash,
        org_msp: orgMsp,
        cert_id: (isQualification || isLicense) ? certId : null,
        mode: anchorOutcome.mode,
        anchored_on_chain: anchoredOnChain
      },
      ocr: {
        extracted_name: ocrFields.name || null,
        extracted_staff_id: ocrFields.staffId || null,
        extracted_qualification: ocrFields.qualification || null,
        extracted_institution: ocrFields.institution || null
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
  getAllReferences
};