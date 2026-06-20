const express = require('express');
const router = express.Router();
const {
  createChangeRequest,
  getMyChangeRequests,
  getAllChangeRequests,
  reviewChangeRequest,
} = require('../controllers/changeRequestController');
const { protect, authorize } = require('../middleware/auth');

router.post('/', protect, authorize('teacher'), createChangeRequest);
router.get('/my', protect, authorize('teacher'), getMyChangeRequests);
router.get('/', protect, authorize('hr_officer', 'admin'), getAllChangeRequests);
router.put('/:id/review', protect, authorize('hr_officer', 'admin'), reviewChangeRequest);

module.exports = router;
