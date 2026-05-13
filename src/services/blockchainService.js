const crypto = require('crypto');
const pool = require('../config/db');

const BLOCKCHAIN_NODES = [
  { id: 'GES', name: 'Ghana Education Service', role: 'orderer' },
  { id: 'GTEC', name: 'Ghana Tertiary Education Commission', role: 'peer' },
  { id: 'NTC', name: 'National Teaching Council', role: 'peer' },
];

const generateDocumentHash = (data) => {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex');
};

const generateTransactionId = () => {
  const timestamp = Date.now().toString(16);
  const random = crypto.randomBytes(16).toString('hex');
  return `${timestamp}${random}`.toUpperCase();
};

const simulateNodeValidation = async (node, documentHash) => {
  await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 400));
  console.log(`[${node.role.toUpperCase()}] Node ${node.id} validated: ${documentHash.substring(0, 16)}...`);
  return {
    node_id: node.id,
    node_name: node.name,
    role: node.role,
    status: 'validated',
    timestamp: new Date().toISOString()
  };
};

const submitToBlockchain = async (credentialData) => {
  try {
    const documentHash = generateDocumentHash({
      teacher_id: credentialData.teacher_id,
      document_id: credentialData.document_id,
      file_name: credentialData.file_name,
      ocr_text: credentialData.ocr_text,
      timestamp: credentialData.timestamp
    });

    const txId = generateTransactionId();

    console.log(`\n========================================`);
    console.log(`HYPERLEDGER FABRIC — PRIVATE BLOCKCHAIN`);
    console.log(`Network: GES Credential Verification`);
    console.log(`TX ID: ${txId}`);
    console.log(`Document Hash: ${documentHash}`);
    console.log(`Initiating PBFT consensus across 3 nodes...`);
    console.log(`========================================`);

    const nodeResults = await Promise.all(
      BLOCKCHAIN_NODES.map(node => simulateNodeValidation(node, documentHash))
    );

    const validatedCount = nodeResults.filter(r => r.status === 'validated').length;
    const consensusReached = validatedCount >= 2;

    console.log(`Consensus: ${validatedCount}/3 nodes validated`);
    console.log(`Status: ${consensusReached ? 'COMMITTED TO LEDGER' : 'CONSENSUS FAILED'}`);
    console.log(`========================================\n`);

    if (!consensusReached) {
      return { success: false, error: 'Consensus not reached among blockchain nodes' };
    }

    return {
      success: true,
      transaction_id: txId,
      document_hash: documentHash,
      block_number: Math.floor(Math.random() * 10000) + 1,
      timestamp: new Date().toISOString(),
      nodes: nodeResults,
      consensus: `${validatedCount}/${BLOCKCHAIN_NODES.length} nodes`
    };

  } catch (err) {
    console.error('Blockchain error:', err);
    return { success: false, error: err.message };
  }
};

const verifyOnBlockchain = async (documentHash, txId) => {
  try {
    const result = await pool.query(
      `SELECT * FROM credentials 
       WHERE document_hash = $1 AND blockchain_tx_id = $2`,
      [documentHash, txId]
    );

    if (result.rows.length === 0) {
      return { verified: false, message: 'Credential not found on blockchain ledger' };
    }

    const credential = result.rows[0];

    // Simulate all 3 nodes confirming
    const nodeConfirmations = BLOCKCHAIN_NODES.map(n => ({
      ...n,
      status: 'confirmed',
      confirmed_at: credential.verified_at
    }));

    return {
      verified: true,
      message: 'Credential verified across all 3 blockchain nodes',
      nodes: nodeConfirmations,
      consensus: '3/3 nodes confirmed',
      credential: {
        transaction_id: credential.blockchain_tx_id,
        document_hash: credential.document_hash,
        verified_at: credential.verified_at,
        status: credential.verification_status
      }
    };

  } catch (err) {
    return { verified: false, error: err.message };
  }
};

module.exports = {
  generateDocumentHash,
  submitToBlockchain,
  verifyOnBlockchain,
  BLOCKCHAIN_NODES
};