const express = require('express');
const router = express.Router();
const {
  submitForVerification,
  getMyCredentials,
  verifyCredentialByTxId,
  getTeacherCredentials
} = require('../controllers/credentialController');
const { protect, authorize } = require('../middleware/auth');

// Teacher routes
router.post('/verify/:documentId', protect, authorize('teacher'), submitForVerification);
router.get('/my', protect, authorize('teacher'), getMyCredentials);

// HR & Admin routes
router.get('/check/:txId', protect, authorize('hr_officer', 'admin'), verifyCredentialByTxId);
router.get('/teacher/:teacherId', protect, authorize('hr_officer', 'admin'), getTeacherCredentials);

module.exports = router;