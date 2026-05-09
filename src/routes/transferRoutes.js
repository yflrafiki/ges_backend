const express = require('express');
const router = express.Router();
const {
  createTransfer,
  getMyTransfers,
  getAllTransfers,
  getTransferById,
  reviewTransfer
} = require('../controllers/transferController');
const { protect, authorize } = require('../middleware/auth');

// Teacher routes
router.post('/', protect, authorize('teacher'), createTransfer);
router.get('/my', protect, authorize('teacher'), getMyTransfers);

// HR & Admin routes
router.get('/', protect, authorize('hr_officer', 'admin'), getAllTransfers);

// Mixed access routes
router.get('/:id', protect, authorize('teacher', 'hr_officer', 'admin'), getTransferById);
router.put('/:id/review', protect, authorize('hr_officer', 'admin'), reviewTransfer);

module.exports = router;