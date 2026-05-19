const crypto = require('crypto');
const pool = require('../config/db');

// Blockchain nodes configuration
const BLOCKCHAIN_NODES = [
  { id: 'GES', name: 'Ghana Education Service', role: 'orderer', mspId: 'GESMSP' },
  { id: 'GTEC', name: 'Ghana Tertiary Education Commission', role: 'peer', mspId: 'GTECMSP' },
  { id: 'NTC', name: 'National Teaching Council', role: 'peer', mspId: 'NTCMSP' },
];

// Generate SHA-256 hash of document
const generateDocumentHash = (data) => {
  return crypto
    .createHash('sha256')
    .update(typeof data === 'string' ? data : JSON.stringify(data))
    .digest('hex');
};

// Generate transaction ID
const generateTransactionId = () => {
  const timestamp = Date.now().toString(16).toUpperCase();
  const random = crypto.randomBytes(16).toString('hex').toUpperCase();
  return `${timestamp}${random}`;
};

// Simulate PBFT consensus across all 3 nodes
const simulatePBFTConsensus = async (operation, data) => {
  console.log(`\n========================================`);
  console.log(`HYPERLEDGER FABRIC — GES PRIVATE NETWORK`);
  console.log(`Operation: ${operation}`);
  console.log(`Channel: ges-channel`);
  console.log(`Chaincode: ges-verify`);
  console.log(`========================================`);

  const results = [];

  for (const node of BLOCKCHAIN_NODES) {
    await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
    const result = {
      node_id: node.id,
      node_name: node.name,
      role: node.role,
      msp_id: node.mspId,
      status: 'endorsed',
      timestamp: new Date().toISOString()
    };
    results.push(result);
    console.log(`[${node.role.toUpperCase()}] ${node.id} (${node.mspId}): ${result.status}`);
  }

  const endorsedCount = results.filter(r => r.status === 'endorsed').length;
  const consensusReached = endorsedCount >= 2;

  console.log(`Endorsements: ${endorsedCount}/${BLOCKCHAIN_NODES.length}`);
  console.log(`Consensus: ${consensusReached ? 'REACHED ✓' : 'FAILED ✗'}`);
  console.log(`========================================\n`);

  return { results, consensusReached, endorsedCount };
};

// Anchor certificate on blockchain (Flow 1)
const anchorCertificate = async (certData) => {
  try {
    const certId = `CERT_${certData.document_id}_${Date.now()}`;
    const docHash = generateDocumentHash(certData.ocr_text || certData.file_name);
    const txId = generateTransactionId();

    console.log(`Anchoring certificate: ${certId}`);
    console.log(`Document Hash: ${docHash}`);

    // Determine which org is anchoring based on cert type
    // GTEC anchors academic qualifications
    // NTC anchors teaching licenses
    // GES anchors general documents
    const orgMsp = certData.cert_type === 'qualification' ? 'GTECMSP' :
                   certData.cert_type === 'license' ? 'NTCMSP' : 'GESMSP';

    const { results, consensusReached } = await simulatePBFTConsensus(
      'AnchorCertificate',
      { certId, docHash, orgMsp }
    );

    if (!consensusReached) {
      return { success: false, error: 'PBFT consensus failed — not enough endorsements' };
    }

    return {
      success: true,
      cert_id: certId,
      transaction_id: txId,
      document_hash: docHash,
      org_msp: orgMsp,
      block_number: Math.floor(Math.random() * 100000) + 1,
      timestamp: new Date().toISOString(),
      nodes: results,
      consensus: `${results.length}/${BLOCKCHAIN_NODES.length} nodes endorsed`
    };

  } catch (err) {
    console.error('Anchor error:', err);
    return { success: false, error: err.message };
  }
};

// Verify certificate on blockchain (Flow 2)
const verifyCertificate = async (certId, documentHash) => {
  try {
    console.log(`Verifying certificate: ${certId}`);

    const { results, consensusReached } = await simulatePBFTConsensus(
      'VerifyCertificate',
      { certId, documentHash }
    );

    if (!consensusReached) {
      return {
        result: 'error',
        message: 'Consensus failed during verification',
        verified: false
      };
    }

    // Query our ledger
    const credResult = await pool.query(
      `SELECT c.*, d.file_name, d.ocr_extracted_text
       FROM credentials c
       JOIN documents d ON c.document_id = d.id
       WHERE c.blockchain_tx_id IS NOT NULL
       AND c.document_hash = $1`,
      [documentHash]
    );

    if (credResult.rows.length === 0) {
      return {
        result: 'not_found',
        message: 'Certificate was never anchored — flagged for manual review',
        verified: false,
        nodes: results
      };
    }

    const credential = credResult.rows[0];

    // Rehash to verify integrity
    const rehash = generateDocumentHash(
      credential.ocr_extracted_text || credential.file_name
    );

    if (rehash !== documentHash) {
      return {
        result: 'mismatch',
        message: 'Document hash mismatch — certificate may have been tampered with',
        verified: false,
        nodes: results
      };
    }

    return {
      result: 'match',
      message: 'Certificate is authentic — hash matches blockchain record',
      verified: true,
      nodes: results,
      consensus: `${results.length}/${BLOCKCHAIN_NODES.length} nodes confirmed`,
      credential: {
        transaction_id: credential.blockchain_tx_id,
        document_hash: credential.document_hash,
        file_name: credential.file_name,
        verified_at: credential.verified_at,
        status: credential.verification_status
      }
    };

  } catch (err) {
    console.error('Verify error:', err);
    return { result: 'error', message: err.message, verified: false };
  }
};

// Submit to blockchain — called when teacher submits doc for verification
const submitToBlockchain = async (credentialData) => {
  try {
    const result = await anchorCertificate({
      document_id: credentialData.document_id,
      teacher_id: credentialData.teacher_id,
      file_name: credentialData.file_name,
      ocr_text: credentialData.ocr_text,
      cert_type: credentialData.cert_type || 'general',
      timestamp: credentialData.timestamp
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      transaction_id: result.transaction_id,
      document_hash: result.document_hash,
      cert_id: result.cert_id,
      block_number: result.block_number,
      timestamp: result.timestamp,
      nodes: result.nodes,
      consensus: result.consensus
    };

  } catch (err) {
    return { success: false, error: err.message };
  }
};

// Verify on blockchain — called when HR verifies a credential
const verifyOnBlockchain = async (documentHash, txId) => {
  try {
    const result = await pool.query(
      `SELECT c.*, d.file_name, d.file_type, d.ocr_extracted_text,
        t.first_name, t.last_name, t.staff_id
       FROM credentials c
       JOIN documents d ON c.document_id = d.id
       JOIN teachers t ON c.teacher_id = t.id
       WHERE c.blockchain_tx_id = $1`,
      [txId]
    );

    if (result.rows.length === 0) {
      return {
        verified: false,
        result: 'not_found',
        message: 'No credential found with this transaction ID'
      };
    }

    const credential = result.rows[0];

    // Run full verification flow
    const verificationResult = await verifyCertificate(
      `CERT_${credential.document_id}`,
      credential.document_hash
    );

    return {
      verified: verificationResult.verified,
      result: verificationResult.result,
      message: verificationResult.message,
      nodes: verificationResult.nodes,
      consensus: verificationResult.consensus,
      credential: {
        transaction_id: credential.blockchain_tx_id,
        document_hash: credential.document_hash,
        file_name: credential.file_name,
        teacher: `${credential.first_name} ${credential.last_name}`,
        staff_id: credential.staff_id,
        verified_at: credential.verified_at,
        status: credential.verification_status
      }
    };

  } catch (err) {
    return { verified: false, error: err.message };
  }
};

// Record promotion decision on blockchain
const recordPromotionDecision = async (promotionData) => {
  try {
    const promotionId = `PROMO_${promotionData.application_id}`;
    const txId = generateTransactionId();

    const { results, consensusReached } = await simulatePBFTConsensus(
      'RecordPromotionDecision',
      promotionData
    );

    if (!consensusReached) {
      return { success: false, error: 'Consensus failed' };
    }

    console.log(`Promotion decision recorded on blockchain: ${promotionId}`);

    return {
      success: true,
      promotion_id: promotionId,
      transaction_id: txId,
      timestamp: new Date().toISOString(),
      nodes: results
    };

  } catch (err) {
    return { success: false, error: err.message };
  }
};

module.exports = {
  generateDocumentHash,
  submitToBlockchain,
  verifyOnBlockchain,
  anchorCertificate,
  verifyCertificate,
  recordPromotionDecision,
  BLOCKCHAIN_NODES
};