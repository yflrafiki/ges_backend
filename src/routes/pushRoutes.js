const express = require('express');
const router = express.Router();
const { getPublicKey, subscribe, unsubscribe } = require('../controllers/pushController');
const { protect } = require('../middleware/auth');

router.get('/public-key', getPublicKey);
router.post('/subscribe', protect, subscribe);
router.post('/unsubscribe', protect, unsubscribe);

module.exports = router;
