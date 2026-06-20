const pool = require('../config/db');
const crypto = require('crypto');
const { invokeChaincode, invokeChaincodeWithTxId, isFabricAvailable } = require('./fabricClient');

const qualCertId = (staffId) => `QUAL_${staffId.toUpperCase()}`;
const licenseCertId = (staffId) => `LICENSE_${staffId.toUpperCase()}`;

// Postgres-backed fallback check, used when the Fabric network isn't reachable.
const verifyAgainstReference = async (staffId, teacherName, documentHash) => {
  try {
    const result = await pool.query(
      `SELECT * FROM blockchain_references WHERE staff_id = $1 ORDER BY created_at DESC`,
      [staffId.toUpperCase()]
    );

    if (result.rows.length === 0) {
      return {
        found: false,
        result: 'not_found',
        message: 'No reference documents found on blockchain for this teacher'
      };
    }

    const references = result.rows;

    const nameMatch = references.some(ref => {
      const refName = (ref.teacher_name || '').toUpperCase();
      const checkName = teacherName.toUpperCase();
      return refName.includes(checkName) || checkName.includes(refName) ||
        refName.split(' ').some((part) => checkName.includes(part) && part.length > 2);
    });

    const hashMatch = references.some(ref => ref.document_hash === documentHash);

    return {
      found: true,
      result: hashMatch ? 'exact_match' : nameMatch ? 'name_match' : 'mismatch',
      message: hashMatch
        ? 'Exact document match found on blockchain'
        : nameMatch
        ? 'Teacher name verified against blockchain reference'
        : 'Document does not match any blockchain reference for this teacher',
      nameMatch,
      hashMatch,
      mode: 'simulation',
      references: references.map(r => ({
        document_type: r.document_type,
        org_msp: r.org_msp,
        blockchain_tx_id: r.blockchain_tx_id,
        issued_by: r.issued_by
      }))
    };

  } catch (err) {
    console.error('Blockchain verification error:', err);
    return { found: false, result: 'error', message: err.message };
  }
};

// Real on-chain verification — calls VerifyQualification (GTEC) or VerifyLicense (NTC)
// with OCR-extracted fields, against whatever GTEC/NTC anchored for this staff ID.
// certType: 'qualification' | 'license'
const verifyOnChain = async (certType, staffId, teacherName, ocrFields = {}) => {
  const certId = certType === 'license' ? licenseCertId(staffId) : qualCertId(staffId);
  const fnName = certType === 'license' ? 'VerifyLicense' : 'VerifyQualification';

  const args = certType === 'license'
    ? [certId, teacherName.toUpperCase(), '', '', '', '']
    : [certId, teacherName.toUpperCase(), ocrFields.institution || '', ocrFields.qualification || '', ''];

  // Read from the owning org's peer directly — GES doesn't hold GTEC's/NTC's
  // implicit private collection, so evaluating through GES alone always misses.
  const endorsingOrganizations = [certType === 'license' ? 'NTCMSP' : 'GTECMSP'];
  const chainResult = await invokeChaincode(fnName, args, { evaluate: true, endorsingOrganizations });

  return {
    found: chainResult.result !== 'not_found',
    result: chainResult.result,
    message: chainResult.message,
    certId,
    mode: 'fabric',
    chainResult
  };
};

// Cross-checks a teacher's uploaded document against GTEC/NTC on the real Fabric
// network when available, falling back to the Postgres reference table otherwise.
const verifyAgainstBlockchain = async ({ certType, staffId, teacherName, documentHash, ocrFields }) => {
  if (isFabricAvailable() && (certType === 'qualification' || certType === 'license')) {
    try {
      return await verifyOnChain(certType, staffId, teacherName, ocrFields || {});
    } catch (err) {
      console.error('On-chain verification error, falling back to reference table:', err.message);
    }
  }
  return verifyAgainstReference(staffId, teacherName, documentHash);
};

// ── Generic document-hash anchoring ─────────────────────────────────────────
// This is the model actually used for teacher document uploads: the hash
// itself, once written to the public ledger, IS the verification record —
// there's no separate pre-anchored reference to check against. Automatically
// called the moment a teacher uploads a document, before OCR runs.

// Anchors a document hash on the real Fabric network (AnchorDocumentHash),
// or simulates it when the network isn't reachable.
const anchorDocumentHash = async (documentHash, staffId, fileName) => {
  if (isFabricAvailable()) {
    try {
      // Public ledger write (PutState, no private collection) — let Fabric
      // Gateway's automatic discovery pick endorsers to satisfy the channel's
      // majority policy, same as RecordPromotionDecision. Pinning specific
      // orgs here fails ("failed to find any endorsing peers") even though
      // GTEC is a legitimate channel member — targeted-org discovery and
      // generic policy-satisfying discovery are different code paths in
      // Fabric, and only the latter reliably works for this org's peer.
      const { txId } = await invokeChaincodeWithTxId('AnchorDocumentHash', [documentHash, staffId, fileName]);
      return { anchored: true, mode: 'fabric', txId };
    } catch (err) {
      console.error('Document hash anchoring failed, falling back to simulation:', err.message);
    }
  }
  // Simulation fallback — record locally so a later verify can still find it.
  await pool.query(
    `INSERT INTO blockchain_references (staff_id, teacher_name, document_type, document_hash, blockchain_tx_id, anchored_on_chain)
     VALUES ($1, '', 'document_hash', $2, $3, false)`,
    [staffId.toUpperCase(), documentHash, crypto.randomBytes(16).toString('hex').toUpperCase()]
  ).catch(() => {});
  return { anchored: true, mode: 'simulation', txId: null };
};

// Verifies a document hash against the ledger (VerifyDocumentHash), or the
// simulation fallback table when the network isn't reachable.
const verifyDocumentHash = async (documentHash, staffId) => {
  if (isFabricAvailable()) {
    try {
      const chainResult = await invokeChaincode('VerifyDocumentHash', [documentHash, staffId], { evaluate: true });
      return {
        found: chainResult.result === 'match',
        result: chainResult.result,
        message: chainResult.message,
        mode: 'fabric'
      };
    } catch (err) {
      console.error('Document hash verification failed, falling back to reference table:', err.message);
    }
  }
  const result = await pool.query(
    `SELECT 1 FROM blockchain_references WHERE staff_id = $1 AND document_hash = $2 LIMIT 1`,
    [staffId.toUpperCase(), documentHash]
  );
  const found = result.rows.length > 0;
  return {
    found,
    result: found ? 'match' : 'not_found',
    message: found ? 'Document hash matches the anchored record (simulation)' : 'No anchored record found for this hash',
    mode: 'simulation'
  };
};

module.exports = {
  verifyAgainstReference, verifyOnChain, verifyAgainstBlockchain, qualCertId, licenseCertId,
  anchorDocumentHash, verifyDocumentHash
};
