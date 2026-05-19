'use strict';

const { Contract } = require('fabric-contract-api');

class GESVerifyContract extends Contract {

  // Anchor a certificate on the blockchain
  async AnchorCertificate(ctx, certId, staffId, docHash, certType, orgMsp) {
    const existing = await ctx.stub.getState(certId);
    if (existing && existing.length > 0) {
      throw new Error(`Certificate ${certId} already anchored`);
    }

    const cert = {
      certId,
      staffId,
      docHash,
      certType,
      orgMsp,
      status: 'active',
      anchoredAt: new Date().toISOString(),
      verificationHistory: []
    };

    await ctx.stub.putState(certId, Buffer.from(JSON.stringify(cert)));

    ctx.stub.setEvent('CertificateAnchored', Buffer.from(JSON.stringify({
      certId, staffId, certType, orgMsp
    })));

    return JSON.stringify(cert);
  }

  // Verify a certificate
  async VerifyCertificate(ctx, certId, docHash) {
    const certBytes = await ctx.stub.getState(certId);

    if (!certBytes || certBytes.length === 0) {
      return JSON.stringify({
        result: 'not_found',
        message: 'Certificate was never anchored — flag for manual review'
      });
    }

    const cert = JSON.parse(certBytes.toString());

    if (cert.status === 'revoked') {
      return JSON.stringify({
        result: 'revoked',
        message: 'Certificate has been revoked',
        certId: cert.certId,
        staffId: cert.staffId
      });
    }

    if (cert.docHash !== docHash) {
      return JSON.stringify({
        result: 'mismatch',
        message: 'Document hash does not match — certificate may have been tampered with',
        certId: cert.certId
      });
    }

    // Record verification in history
    cert.verificationHistory.push({
      verifiedAt: new Date().toISOString(),
      result: 'match'
    });

    await ctx.stub.putState(certId, Buffer.from(JSON.stringify(cert)));

    return JSON.stringify({
      result: 'match',
      message: 'Certificate is authentic',
      certId: cert.certId,
      staffId: cert.staffId,
      certType: cert.certType,
      orgMsp: cert.orgMsp,
      anchoredAt: cert.anchoredAt
    });
  }

  // Revoke a certificate
  async RevokeCertificate(ctx, certId, reason) {
    const certBytes = await ctx.stub.getState(certId);

    if (!certBytes || certBytes.length === 0) {
      throw new Error(`Certificate ${certId} not found`);
    }

    const cert = JSON.parse(certBytes.toString());
    cert.status = 'revoked';
    cert.revokedAt = new Date().toISOString();
    cert.revokeReason = reason;

    await ctx.stub.putState(certId, Buffer.from(JSON.stringify(cert)));

    ctx.stub.setEvent('CertificateRevoked', Buffer.from(JSON.stringify({
      certId, reason
    })));

    return JSON.stringify(cert);
  }

  // Record a promotion decision
  async RecordPromotionDecision(ctx, promotionId, staffId, fromGrade, toGrade, decision, decidedBy) {
    const promotion = {
      promotionId,
      staffId,
      fromGrade,
      toGrade,
      decision,
      decidedBy,
      recordedAt: new Date().toISOString()
    };

    await ctx.stub.putState(
      `PROMOTION_${promotionId}`,
      Buffer.from(JSON.stringify(promotion))
    );

    ctx.stub.setEvent('PromotionRecorded', Buffer.from(JSON.stringify(promotion)));

    return JSON.stringify(promotion);
  }

  // Get certificate details
  async GetCertificate(ctx, certId) {
    const certBytes = await ctx.stub.getState(certId);
    if (!certBytes || certBytes.length === 0) {
      throw new Error(`Certificate ${certId} not found`);
    }
    return certBytes.toString();
  }
}

module.exports = { contracts: [GESVerifyContract] };