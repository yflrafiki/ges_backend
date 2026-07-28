const express = require('express');
const {
  uploadAllData,
  uploadQualificationsOnly,
  uploadLicensesOnly,
  uploadQualification,
  uploadLicense,
  healthCheck
} = require('../controllers/blockchainUploadController');

const router = express.Router();

/**
 * Health check endpoint
 * GET /api/blockchain/upload/health
 */
router.get('/health', healthCheck);

/**
 * Upload all mock data (qualifications + licenses)
 * POST /api/blockchain/upload/all
 */
router.post('/all', uploadAllData);

/**
 * Upload qualifications only (GTEC)
 * POST /api/blockchain/upload/qualifications
 */
router.post('/qualifications', uploadQualificationsOnly);

/**
 * Upload licenses only (NTC)
 * POST /api/blockchain/upload/licenses
 */
router.post('/licenses', uploadLicensesOnly);

/**
 * Upload a single qualification record
 * POST /api/blockchain/upload/qualification
 * Body: { certId, staffName, institution, degree, fieldOfStudy, dateConferred }
 */
router.post('/qualification', uploadQualification);

/**
 * Upload a single license record
 * POST /api/blockchain/upload/license
 * Body: { certId, staffName, professionalStatus, subjectSpecialism, teachingLevel, issueDate, expiryDate }
 */
router.post('/license', uploadLicense);

module.exports = router;
