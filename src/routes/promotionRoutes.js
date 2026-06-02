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

const ensureTeacherProfile = require('../middleware/ensureTeacherProfile');

// Teacher routes
router.get('/eligibility', protect, authorize('teacher'), ensureTeacherProfile, checkPromotionEligibility);
router.get('/form', protect, authorize('teacher'), ensureTeacherProfile, getPromotionForm);
router.post('/', protect, authorize('teacher'), ensureTeacherProfile, applyForPromotion);
router.get('/my', protect, authorize('teacher'), ensureTeacherProfile, getMyPromotions);
router.post('/:id/submit-document', protect, authorize('teacher'), ensureTeacherProfile, submitPromotionDocument);

// HR & Admin routes
router.get('/documents', protect, authorize('hr_officer', 'admin'), getPromotionDocuments);
router.put('/documents/:id/review', protect, authorize('hr_officer', 'admin'), reviewPromotionDocument);
router.get('/', protect, authorize('hr_officer', 'admin'), getAllPromotions);
router.put('/:id/review', protect, authorize('hr_officer', 'admin'), reviewPromotion);

// Mixed
router.get('/:id', protect, authorize('teacher', 'hr_officer', 'admin'), getPromotionById);

module.exports = router;