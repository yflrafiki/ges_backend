const express = require('express');
const router = express.Router();
const {
  getMyCredentials,
  verifyCredentialByTxId,
  getTeacherCredentials,
  getVerifiedTeachers,
  getBlockchainNodes
} = require('../controllers/credentialController');
const { protect, authorize } = require('../middleware/auth');

const ensureTeacherProfile = require('../middleware/ensureTeacherProfile');

// Teacher routes — verification is fully automatic on upload, no manual trigger needed.
router.get('/my', protect, authorize('teacher'), ensureTeacherProfile, getMyCredentials);

// HR & Admin routes
router.get('/nodes', protect, authorize('hr_officer', 'admin'), getBlockchainNodes);
router.get('/verified-teachers', protect, authorize('hr_officer', 'admin'), getVerifiedTeachers);
router.get('/check/:txId', protect, authorize('hr_officer', 'admin'), verifyCredentialByTxId);
router.get('/teacher/:teacherId', protect, authorize('hr_officer', 'admin'), getTeacherCredentials);

module.exports = router;