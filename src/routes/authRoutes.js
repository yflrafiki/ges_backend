const express = require('express');
const router = express.Router();
const { register, login, getMe, changePassword, verifyEmail, getUsersByRole } = require('../controllers/authController');
const { protect, authorize } = require('../middleware/auth');

router.post('/register', protect, authorize('admin'), register);
router.post('/login', login);
router.post('/verify-email', verifyEmail);
router.get('/me', protect, getMe);
router.put('/change-password', protect, changePassword);
router.get('/users', protect, authorize('admin'), getUsersByRole);

module.exports = router;