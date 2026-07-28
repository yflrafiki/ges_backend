const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { chat } = require('../controllers/aiController');

router.post('/chat', protect, chat);

module.exports = router;
