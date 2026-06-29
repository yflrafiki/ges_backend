const express = require('express');
const router = express.Router();
const {
  register, login, getMe, changePassword, verifyEmailCode, resendVerificationCode,
  forgotPassword, resetPassword, getUsersByRole,
} = require('../controllers/authController');
const { protect, authorize } = require('../middleware/auth');
const upload = require('../config/multer');

const registrationDocs = upload.fields([
  { name: 'nss_certificate', maxCount: 1 },
  { name: 'degree_certificate', maxCount: 1 },
  { name: 'appointment_letter', maxCount: 1 },
]);

router.post('/register', protect, authorize('admin', 'hr_officer'), registrationDocs, register);
router.post('/login', login);
router.post('/verify-email-code', verifyEmailCode);
router.post('/resend-verification-code', resendVerificationCode);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/me', protect, getMe);
router.put('/change-password', protect, changePassword);
router.get('/users', protect, authorize('admin'), getUsersByRole);

module.exports = router;