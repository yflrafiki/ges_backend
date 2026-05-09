const express = require('express');
const router = express.Router();
const {
  checkPromotionEligibility,
  applyForPromotion,
  getMyPromotions,
  getAllPromotions,
  getPromotionById,
  reviewPromotion
} = require('../controllers/promotionController');
const { protect, authorize } = require('../middleware/auth');

// Teacher routes
router.get('/eligibility', protect, authorize('teacher'), checkPromotionEligibility);
router.post('/', protect, authorize('teacher'), applyForPromotion);
router.get('/my', protect, authorize('teacher'), getMyPromotions);

// HR & Admin routes
router.get('/', protect, authorize('hr_officer', 'admin'), getAllPromotions);

// Mixed access
router.get('/:id', protect, authorize('teacher', 'hr_officer', 'admin'), getPromotionById);
router.put('/:id/review', protect, authorize('hr_officer', 'admin'), reviewPromotion);

module.exports = router;