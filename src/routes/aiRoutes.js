const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { chat, transferSummary } = require('../controllers/aiController');

router.post('/chat', protect, chat);
router.post('/transfer-summary', protect, authorize('hr_officer', 'admin'), transferSummary);

module.exports = router;
