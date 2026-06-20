const crypto = require('crypto');
const pool = require('../config/db');
const { invokeChaincode, isFabricAvailable, CHANNEL, CHAINCODE } = require('./fabricClient');

const BLOCKCHAIN_NODES = [
  { id: 'GES',  name: 'Ghana Education Service',            role: 'peer',    mspId: 'GESMSP'   },
  { id: 'GTEC', name: 'Ghana Tertiary Education Commission', role: 'peer',    mspId: 'GTECMSP'  },
  { id: 'NTC',  name: 'National Teaching Council',           role: 'peer',    mspId: 'NTCMSP'   },
];

const generateDocumentHash = (data) =>
  crypto.createHash('sha256')
    .update(typeof data === 'string' ? data : JSON.stringify(data))
    .digest('hex');

const generateTransactionId = () =>
  `${Date.now().toString(16).toUpperCase()}${crypto.randomBytes(16).toString('hex').toUpperCase()}`;

// ── Simulation fallback (used when Fabric network is not running) ──────────
const simulateNodes = () =>
  BLOCKCHAIN_NODES.map(n => ({
    node_id:   n.id,
    node_name: n.name,
    role:      n.role,
    msp_id:    n.mspId,
    status:    'endorsed',
    timestamp: new Date().toISOString(),
    mode:      'simulation',
  }));

// ── submitToBlockchain ─────────────────────────────────────────────────────
// Called when a teacher submits a document for credential verification.
// cert_type: 'qualification' → AnchorQualification (GTEC)
//            'license'       → AnchorLicense       (NTC)
//            anything else   → records hash only (no chaincode function)
const submitToBlockchain = async (credentialData) => {
  const {
    document_id, file_name, ocr_text, cert_type = 'general',
    ocr_fields = {}
  } = credentialData;

  const certId      = `CERT_${document_id}_${Date.now()}`;
  const documentHash = generateDocumentHash(ocr_text || file_name);

  const useFabric = isFabricAvailable();
  let nodes        = simulateNodes();
  let txId         = generateTransactionId();
  let chaincodeResult = null;

  console.log(`\n[Blockchain] submitToBlockchain — ${useFabric ? 'FABRIC' : 'SIMULATION'}`);
  console.log(`  certId: ${certId}  type: ${cert_type}`);

  try {
    if (useFabric && cert_type === 'qualification') {
      // AnchorQualification(certId, staffName, institution, degree, fieldOfStudy, dateConferred)
      chaincodeResult = await invokeChaincode('AnchorQualification', [
        certId,
        ocr_fields.staff_name     || '',
        ocr_fields.institution    || '',
        ocr_fields.degree         || '',
        ocr_fields.field_of_study || '',
        ocr_fields.date_conferred || '',
      ], { endorsingOrganizations: ['GESMSP', 'GTECMSP'] });
      console.log(`  ✓ AnchorQualification committed`);

    } else if (useFabric && cert_type === 'license') {
      // AnchorLicense(certId, staffName, professionalStatus, subjectSpecialism, teachingLevel, issueDate, expiryDate)
      chaincodeResult = await invokeChaincode('AnchorLicense', [
        certId,
        ocr_fields.staff_name          || '',
        ocr_fields.professional_status || '',
        ocr_fields.subject_specialism  || '',
        ocr_fields.teaching_level      || '',
        ocr_fields.issue_date          || '',
        ocr_fields.expiry_date         || '',
      ], { endorsingOrganizations: ['GESMSP', 'NTCMSP'] });
      console.log(`  ✓ AnchorLicense committed`);

    } else if (!useFabric) {
      // Simulate short delay per node
      await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
      console.log(`  ✓ Simulation: 3/3 nodes endorsed`);
    }

  } catch (err) {
    console.error(`  ✗ Chaincode error: ${err.message}`);
    return { success: false, error: err.message };
  }

  return {
    success:        true,
    transaction_id: txId,
    document_hash:  documentHash,
    cert_id:        certId,
    block_number:   chaincodeResult ? undefined : Math.floor(Math.random() * 100000) + 1,
    channel:        CHANNEL,
    chaincode:      CHAINCODE,
    timestamp:      new Date().toISOString(),
    nodes,
    consensus:      `${nodes.length}/${BLOCKCHAIN_NODES.length} nodes endorsed`,
    fabric_live:    useFabric,
  };
};

// ── verifyOnBlockchain ─────────────────────────────────────────────────────
// Called by HR when verifying a credential by transaction ID.
// Routes to VerifyQualification or VerifyLicense based on stored cert_type,
// or falls back to local hash check when Fabric is unavailable.
const verifyOnBlockchain = async (documentHash, txId) => {
  try {
    const result = await pool.query(
      `SELECT c.*, d.file_name, d.file_type, d.ocr_extracted_text, d.ocr_validation,
              t.first_name, t.last_name, t.staff_id
       FROM credentials c
       JOIN documents d ON c.document_id = d.id
       JOIN teachers t  ON c.teacher_id  = t.id
       WHERE c.blockchain_tx_id = $1`,
      [txId]
    );

    if (result.rows.length === 0) {
      return { verified: false, result: 'not_found', message: 'No credential found with this transaction ID' };
    }

    const cred       = result.rows[0];
    const useFabric  = isFabricAvailable();
    const nodes      = simulateNodes();

    // Parse OCR validation for cert_id and fields
    let ocr = {};
    try { ocr = JSON.parse(cred.ocr_validation || '{}'); } catch {}

    const certId   = ocr.cert_id   || `CERT_${cred.document_id}`;
    const certType = ocr.cert_type || 'general';

    console.log(`\n[Blockchain] verifyOnBlockchain — ${useFabric ? 'FABRIC' : 'SIMULATION'}`);
    console.log(`  txId: ${txId}  certType: ${certType}`);

    let chaincodeResult = null;

    try {
      if (useFabric && certType === 'qualification') {
        const f = ocr.parsed_fields || {};
        chaincodeResult = await invokeChaincode('VerifyQualification', [
          certId,
          f.staff_name     || `${cred.first_name} ${cred.last_name}`,
          f.institution    || '',
          f.degree         || '',
          f.field_of_study || '',
        ], { evaluate: true, endorsingOrganizations: ['GTECMSP'] });

      } else if (useFabric && certType === 'license') {
        const f = ocr.parsed_fields || {};
        chaincodeResult = await invokeChaincode('VerifyLicense', [
          certId,
          f.staff_name          || `${cred.first_name} ${cred.last_name}`,
          f.professional_status || '',
          f.subject_specialism  || '',
          f.teaching_level      || '',
          f.expiry_date         || '',
        ], { evaluate: true, endorsingOrganizations: ['NTCMSP'] });
      }
    } catch (err) {
      console.error(`  ✗ Chaincode verify error: ${err.message}`);
      return { verified: false, result: 'error', message: err.message, nodes };
    }

    // Use chaincode result if available, otherwise local hash check
    let verResult, verMessage, verified;

    if (chaincodeResult) {
      verResult  = chaincodeResult.result;
      verMessage = chaincodeResult.message;
      verified   = chaincodeResult.result === 'match';
      console.log(`  Chaincode result: ${verResult}`);
    } else {
      // Simulation: rehash and compare
      const rehash = generateDocumentHash(cred.ocr_extracted_text || cred.file_name);
      if (rehash === documentHash) {
        verResult = 'match'; verMessage = 'Certificate is authentic — hash matches ledger record'; verified = true;
      } else {
        verResult = 'mismatch'; verMessage = 'Document hash mismatch — possible tampering'; verified = false;
      }
    }

    return {
      verified,
      result:    verResult,
      message:   verMessage,
      nodes,
      consensus:   `${nodes.length}/${BLOCKCHAIN_NODES.length} nodes confirmed`,
      fabric_live: useFabric,
      channel:     CHANNEL,
      chaincode:   CHAINCODE,
      credential: {
        transaction_id: cred.blockchain_tx_id,
        document_hash:  cred.document_hash,
        file_name:      cred.file_name,
        teacher:        `${cred.first_name} ${cred.last_name}`,
        staff_id:       cred.staff_id,
        verified_at:    cred.verified_at,
        status:         cred.verification_status,
      },
    };

  } catch (err) {
    console.error('verifyOnBlockchain error:', err);
    return { verified: false, result: 'error', message: err.message };
  }
};

// ── recordPromotionDecision ────────────────────────────────────────────────
// Writes approved/rejected promotion to the public ledger via GES.
const recordPromotionDecision = async (promotionData) => {
  const {
    application_id, staff_id = '', old_rank = '', new_rank = '',
    qual_cert_id = '', license_cert_id = '', approved_by = '', gazette_number = ''
  } = promotionData;

  const promotionId = `PROMO_${application_id}`;
  const txId        = generateTransactionId();
  const useFabric   = isFabricAvailable();

  console.log(`\n[Blockchain] recordPromotionDecision — ${useFabric ? 'FABRIC' : 'SIMULATION'}`);

  try {
    if (useFabric) {
      await invokeChaincode('RecordPromotionDecision', [
        promotionId, staff_id, old_rank, new_rank,
        qual_cert_id, license_cert_id, approved_by, gazette_number,
      ]);
      console.log(`  ✓ RecordPromotionDecision committed`);
    } else {
      await new Promise(r => setTimeout(r, 600));
      console.log(`  ✓ Simulation: promotion recorded`);
    }
  } catch (err) {
    console.error(`  ✗ Chaincode error: ${err.message}`);
    return { success: false, error: err.message };
  }

  return {
    success:      true,
    promotion_id: promotionId,
    transaction_id: txId,
    timestamp:    new Date().toISOString(),
    fabric_live:  useFabric,
    nodes:        simulateNodes(),
  };
};

// ── getNetworkStatus ───────────────────────────────────────────────────────
// Returns live chaincode HealthCheck if Fabric is up, otherwise reports simulation mode.
const getNetworkStatus = async () => {
  const useFabric = isFabricAvailable();
  const nodes = BLOCKCHAIN_NODES.map(n => ({
    ...n,
    status:    'active',
    mode:      useFabric ? 'live' : 'simulation',
  }));

  if (!useFabric) {
    return { network: 'Hyperledger Fabric', channel: CHANNEL, chaincode: CHAINCODE,
             fabric_live: false, mode: 'simulation', nodes };
  }

  try {
    const health = await invokeChaincode('HealthCheck', [], { evaluate: true });
    return {
      network:     'Hyperledger Fabric',
      channel:     CHANNEL,
      chaincode:   CHAINCODE,
      fabric_live: true,
      mode:        'live',
      health,
      nodes,
    };
  } catch (err) {
    return { network: 'Hyperledger Fabric', channel: CHANNEL, chaincode: CHAINCODE,
             fabric_live: false, mode: 'degraded', error: err.message, nodes };
  }
};

module.exports = {
  generateDocumentHash,
  submitToBlockchain,
  verifyOnBlockchain,
  recordPromotionDecision,
  getNetworkStatus,
  BLOCKCHAIN_NODES,
};
