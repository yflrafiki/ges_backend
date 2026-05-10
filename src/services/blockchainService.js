const crypto = require('crypto');
const pool = require('../config/db');

// Generate a cryptographic hash of document content
const generateDocumentHash = (data) => {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex');
};

// Generate a realistic transaction ID
const generateTransactionId = () => {
  const timestamp = Date.now().toString(16);
  const random = crypto.randomBytes(16).toString('hex');
  return `${timestamp}${random}`.toUpperCase();
};

// Submit credential to blockchain ledger
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

    // Simulate blockchain network delay / consensus
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log(`Blockchain TX submitted: ${txId}`);
    console.log(`Document hash: ${documentHash}`);

    return {
      success: true,
      transaction_id: txId,
      document_hash: documentHash,
      block_number: Math.floor(Math.random() * 10000) + 1,
      timestamp: new Date().toISOString()
    };

  } catch (err) {
    console.error('Blockchain submission error:', err);
    return {
      success: false,
      error: err.message
    };
  }
};

// Verify a credential on the blockchain ledger
const verifyOnBlockchain = async (documentHash, txId) => {
  try {
    const result = await pool.query(
      `SELECT * FROM credentials 
       WHERE document_hash = $1 AND blockchain_tx_id = $2`,
      [documentHash, txId]
    );

    if (result.rows.length === 0) {
      return {
        verified: false,
        message: 'Credential not found on blockchain ledger'
      };
    }

    const credential = result.rows[0];

    return {
      verified: true,
      message: 'Credential verified on blockchain ledger',
      credential: {
        transaction_id: credential.blockchain_tx_id,
        document_hash: credential.document_hash,
        verified_at: credential.verified_at,
        status: credential.verification_status
      }
    };

  } catch (err) {
    console.error('Blockchain verification error:', err);
    return {
      verified: false,
      error: err.message
    };
  }
};

module.exports = {
  generateDocumentHash,
  submitToBlockchain,
  verifyOnBlockchain
};