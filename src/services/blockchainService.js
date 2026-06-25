const crypto = require('crypto');
const pool = require('../config/db');
const { invokeChaincode, invokeChaincodeWithTxId, CHANNEL, CHAINCODE } = require('./fabricClient');

const BLOCKCHAIN_NODES = [
  { id: 'GES',  name: 'Ghana Education Service',            role: 'peer',    mspId: 'GESMSP'   },
  { id: 'GTEC', name: 'Ghana Tertiary Education Commission', role: 'peer',    mspId: 'GTECMSP'  },
  { id: 'NTC',  name: 'National Teaching Council',           role: 'peer',    mspId: 'NTCMSP'   },
];

const generateDocumentHash = (data) =>
  crypto.createHash('sha256')
    .update(typeof data === 'string' ? data : JSON.stringify(data))
    .digest('hex');

// Nodes that actually endorsed a given transaction, based on the orgs pinned
// via endorsingOrganizations — reported only after a real chaincode commit.
const nodesFor = (mspIds) =>
  BLOCKCHAIN_NODES
    .filter(n => mspIds.includes(n.mspId))
    .map(n => ({
      node_id: n.id, node_name: n.name, role: n.role, msp_id: n.mspId,
      status: 'endorsed', timestamp: new Date().toISOString(),
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

  const certId       = `CERT_${document_id}_${Date.now()}`;
  const documentHash = generateDocumentHash(ocr_text || file_name);

  console.log(`\n[Blockchain] submitToBlockchain — certId: ${certId}  type: ${cert_type}`);

  let txId, endorsingOrgs = [];

  try {
    if (cert_type === 'qualification') {
      endorsingOrgs = ['GESMSP', 'GTECMSP'];
      const { txId: tx } = await invokeChaincodeWithTxId('AnchorQualification', [
        certId,
        ocr_fields.staff_name     || '',
        ocr_fields.institution    || '',
        ocr_fields.degree         || '',
        ocr_fields.field_of_study || '',
        ocr_fields.date_conferred || '',
      ], { endorsingOrganizations: endorsingOrgs });
      txId = tx;
      console.log(`  ✓ AnchorQualification committed — tx ${txId}`);

    } else if (cert_type === 'license') {
      endorsingOrgs = ['GESMSP', 'NTCMSP'];
      const { txId: tx } = await invokeChaincodeWithTxId('AnchorLicense', [
        certId,
        ocr_fields.staff_name          || '',
        ocr_fields.professional_status || '',
        ocr_fields.subject_specialism  || '',
        ocr_fields.teaching_level      || '',
        ocr_fields.issue_date          || '',
        ocr_fields.expiry_date         || '',
      ], { endorsingOrganizations: endorsingOrgs });
      txId = tx;
      console.log(`  ✓ AnchorLicense committed — tx ${txId}`);
    }
    // cert_type 'general' (or anything else): no chaincode function exists for
    // it — only the hash itself gets recorded, with no on-chain transaction.
  } catch (err) {
    console.error(`  ✗ Chaincode error: ${err.message}`);
    return { success: false, error: err.message };
  }

  const nodes = endorsingOrgs.length ? nodesFor(endorsingOrgs) : [];

  return {
    success:        true,
    transaction_id: txId || null,
    document_hash:  documentHash,
    cert_id:        certId,
    channel:        CHANNEL,
    chaincode:      CHAINCODE,
    timestamp:      new Date().toISOString(),
    nodes,
    consensus:      nodes.length ? `${nodes.length}/${nodes.length} nodes endorsed` : 'not anchored on-chain — hash recorded only',
    fabric_live:    true,
  };
};

// ── verifyOnBlockchain ─────────────────────────────────────────────────────
// Called by HR when verifying a credential by transaction ID. Routes to
// VerifyQualification or VerifyLicense based on the stored cert_type.
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

    const cred = result.rows[0];

    let ocr = {};
    try { ocr = JSON.parse(cred.ocr_validation || '{}'); } catch {}

    const certId   = ocr.cert_id   || `CERT_${cred.document_id}`;
    const certType = ocr.cert_type || 'general';

    console.log(`\n[Blockchain] verifyOnBlockchain — txId: ${txId}  certType: ${certType}`);

    if (certType !== 'qualification' && certType !== 'license') {
      return { verified: false, result: 'not_anchored', message: 'This credential type was not anchored on the blockchain — nothing to verify on-chain' };
    }

    const endorsingOrgs = certType === 'qualification' ? ['GTECMSP'] : ['NTCMSP'];
    const f = ocr.parsed_fields || {};

    let chaincodeResult;
    try {
      chaincodeResult = certType === 'qualification'
        ? await invokeChaincode('VerifyQualification', [
            certId,
            f.staff_name     || `${cred.first_name} ${cred.last_name}`,
            f.institution    || '',
            f.degree         || '',
            f.field_of_study || '',
          ], { evaluate: true, endorsingOrganizations: endorsingOrgs })
        : await invokeChaincode('VerifyLicense', [
            certId,
            f.staff_name          || `${cred.first_name} ${cred.last_name}`,
            f.professional_status || '',
            f.subject_specialism  || '',
            f.teaching_level      || '',
            f.expiry_date         || '',
          ], { evaluate: true, endorsingOrganizations: endorsingOrgs });
    } catch (err) {
      console.error(`  ✗ Chaincode verify error: ${err.message}`);
      return { verified: false, result: 'error', message: err.message };
    }

    const verResult  = chaincodeResult?.result;
    const verMessage = chaincodeResult?.message;
    const verified   = verResult === 'match';
    console.log(`  Chaincode result: ${verResult}`);

    const nodes = nodesFor(endorsingOrgs);

    return {
      verified,
      result:    verResult,
      message:   verMessage,
      nodes,
      consensus:   `${nodes.length}/${nodes.length} nodes confirmed`,
      fabric_live: true,
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

  console.log(`\n[Blockchain] recordPromotionDecision — ${promotionId}`);

  let txId;
  try {
    const { txId: tx } = await invokeChaincodeWithTxId('RecordPromotionDecision', [
      promotionId, staff_id, old_rank, new_rank,
      qual_cert_id, license_cert_id, approved_by, gazette_number,
    ]);
    txId = tx;
    console.log(`  ✓ RecordPromotionDecision committed — tx ${txId}`);
  } catch (err) {
    console.error(`  ✗ Chaincode error: ${err.message}`);
    return { success: false, error: err.message };
  }

  return {
    success:        true,
    promotion_id:   promotionId,
    transaction_id: txId,
    timestamp:      new Date().toISOString(),
    fabric_live:    true,
    nodes:          nodesFor(['GESMSP']),
  };
};

// ── getNetworkStatus ───────────────────────────────────────────────────────
// Reports real chaincode HealthCheck status — fabric_live: false with the
// actual connection error if the network can't be reached, never fabricated.
const getNetworkStatus = async () => {
  try {
    const health = await invokeChaincode('HealthCheck', [], { evaluate: true });
    return {
      network:     'Hyperledger Fabric',
      channel:     CHANNEL,
      chaincode:   CHAINCODE,
      fabric_live: true,
      health,
      nodes: BLOCKCHAIN_NODES.map(n => ({ ...n, status: 'active' })),
    };
  } catch (err) {
    return {
      network:     'Hyperledger Fabric',
      channel:     CHANNEL,
      chaincode:   CHAINCODE,
      fabric_live: false,
      error:       err.message,
      nodes: BLOCKCHAIN_NODES.map(n => ({ ...n, status: 'unreachable' })),
    };
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
