const { invokeChaincode, invokeChaincodeWithTxId } = require('./fabricClient');

const qualCertId = (staffId) => `QUAL_${staffId.toUpperCase()}`;
const licenseCertId = (staffId) => `LICENSE_${staffId.toUpperCase()}`;

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

// ── Generic document-hash anchoring ─────────────────────────────────────────
// This is the model actually used for teacher document uploads: the hash
// itself, once written to the public ledger, IS the verification record —
// there's no separate pre-anchored reference to check against. Automatically
// called the moment a teacher uploads a document, before OCR runs.

// Anchors a document hash on the real Fabric network (AnchorDocumentHash).
// Throws on failure — callers must handle the rejection themselves, since
// there's no fallback: an anchor either really happened or it didn't.
const anchorDocumentHash = async (documentHash, staffId, fileName) => {
  // Public ledger write (PutState, no private collection) — let Fabric
  // Gateway's automatic discovery pick endorsers to satisfy the channel's
  // majority policy, same as RecordPromotionDecision. Pinning specific
  // orgs here fails ("failed to find any endorsing peers") even though
  // GTEC is a legitimate channel member — targeted-org discovery and
  // generic policy-satisfying discovery are different code paths in
  // Fabric, and only the latter reliably works for this org's peer.
  const { txId } = await invokeChaincodeWithTxId('AnchorDocumentHash', [documentHash, staffId, fileName]);
  return { anchored: true, mode: 'fabric', txId };
};

module.exports = {
  verifyOnChain, qualCertId, licenseCertId, anchorDocumentHash
};
