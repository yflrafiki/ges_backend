const express = require('express');
const router = express.Router();
const {
  checkPromotionEligibility,
  getPromotionForm,
  applyForPromotion,
  getMyPromotions,
  getAllPromotions,
  getPromotionById,
  reviewPromotion,
  submitPromotionDocument,
  getPromotionDocuments,
  reviewPromotionDocument
} = require('../controllers/promotionController');
const { protect, authorize } = require('../middleware/auth');

// Teacher routes
router.get('/eligibility', protect, authorize('teacher'), checkPromotionEligibility);
router.get('/form', protect, authorize('teacher'), getPromotionForm);
router.post('/', protect, authorize('teacher'), applyForPromotion);
router.get('/my', protect, authorize('teacher'), getMyPromotions);
router.post('/:id/submit-document', protect, authorize('teacher'), submitPromotionDocument);

// HR & Admin routes
router.get('/documents', protect, authorize('hr_officer', 'admin'), getPromotionDocuments);
router.put('/documents/:id/review', protect, authorize('hr_officer', 'admin'), reviewPromotionDocument);
router.get('/', protect, authorize('hr_officer', 'admin'), getAllPromotions);
router.put('/:id/review', protect, authorize('hr_officer', 'admin'), reviewPromotion);

// Mixed
router.get('/:id', protect, authorize('teacher', 'hr_officer', 'admin'), getPromotionById);

module.exports = router;