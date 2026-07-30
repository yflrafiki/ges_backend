const express = require('express');
const router = express.Router();
const {
  createChangeRequest,
  getMyChangeRequests,
  getAllChangeRequests,
  reviewChangeRequest,
  getChangeRequestDocument,
} = require('../controllers/changeRequestController');
const { protect, authorize } = require('../middleware/auth');
const upload = require('../config/multer');

router.post('/', protect, authorize('teacher'), upload.single('document'), createChangeRequest);
router.get('/my', protect, authorize('teacher'), getMyChangeRequests);
router.get('/', protect, authorize('hr_officer', 'admin'), getAllChangeRequests);
router.put('/:id/review', protect, authorize('admin'), reviewChangeRequest);
router.get('/:id/document', protect, authorize('teacher', 'hr_officer', 'admin'), getChangeRequestDocument);

module.exports = router;
