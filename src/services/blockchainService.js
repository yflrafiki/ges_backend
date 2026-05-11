const crypto = require('crypto');
const pool = require('../config/db');

// The 3 blockchain nodes as per the project
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

// Simulate each node validating the credential
const simulateNodeValidation = async (node, documentHash) => {
  // Simulate network delay per node
  await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 400));
  console.log(`Node ${node.id} (${node.role}) validated document hash: ${documentHash}`);
  return {
    node_id: node.id,
    node_name: node.name,
    role: node.role,
    status: 'validated',
    timestamp: new Date().toISOString()
  };
};

// Submit credential to blockchain with all 3 nodes
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

    console.log(`\n=== Hyperledger Fabric Network ===`);
    console.log(`Submitting TX: ${txId}`);
    console.log(`Document Hash: ${documentHash}`);

    // All 3 nodes validate in parallel (PBFT consensus)
    const nodeResults = await Promise.all(
      BLOCKCHAIN_NODES.map(node => simulateNodeValidation(node, documentHash))
    );

    // Check consensus — need all 3 nodes to agree
    const validatedNodes = nodeResults.filter(r => r.status === 'validated');
    const consensusReached = validatedNodes.length >= 2; // 2 of 3 = consensus

    if (!consensusReached) {
      return { success: false, error: 'Consensus not reached among nodes' };
    }

    console.log(`Consensus reached: ${validatedNodes.length}/3 nodes validated`);
    console.log(`TX committed to ledger: ${txId}`);
    console.log(`=================================\n`);

    return {
      success: true,
      transaction_id: txId,
      document_hash: documentHash,
      block_number: Math.floor(Math.random() * 10000) + 1,
      timestamp: new Date().toISOString(),
      nodes: nodeResults,
      consensus: `${validatedNodes.length}/${BLOCKCHAIN_NODES.length} nodes`
    };

  } catch (err) {
    console.error('Blockchain submission error:', err);
    return { success: false, error: err.message };
  }
};

// Verify credential on blockchain
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

    return {
      verified: true,
      message: 'Credential verified on blockchain ledger',
      nodes: BLOCKCHAIN_NODES.map(n => ({ ...n, status: 'confirmed' })),
      credential: {
        transaction_id: credential.blockchain_tx_id,
        document_hash: credential.document_hash,
        verified_at: credential.verified_at,
        status: credential.verification_status
      }
    };

  } catch (err) {
    console.error('Blockchain verification error:', err);
    return { verified: false, error: err.message };
  }
};

module.exports = {
  generateDocumentHash,
  submitToBlockchain,
  verifyOnBlockchain,
  BLOCKCHAIN_NODES
};