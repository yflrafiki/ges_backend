const express = require('express');
const router = express.Router();
const { getCrisis } = require('../controllers/staffingController');
const { protect, authorize } = require('../middleware/auth');

router.get('/crisis', protect, authorize('admin', 'hr_officer'), getCrisis);

module.exports = router;
