const express = require('express');
const router = express.Router();
const { getMyNotifications, getUnreadCount, markAsRead, markAllAsRead, streamNotifications } = require('../controllers/notificationController');
const { protect, protectSSE } = require('../middleware/auth');

router.get('/stream', protectSSE, streamNotifications);
router.get('/', protect, getMyNotifications);
router.get('/unread-count', protect, getUnreadCount);
router.put('/read-all', protect, markAllAsRead);
router.put('/:id/read', protect, markAsRead);

module.exports = router;
