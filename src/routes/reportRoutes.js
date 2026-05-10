const express = require('express');
const router = express.Router();
const {
  getDashboardSummary,
  getTransferReport,
  getPromotionReport,
  getCredentialReport,
  getAuditLog,
  getTeacherHistory
} = require('../controllers/reportController');
const { protect, authorize } = require('../middleware/auth');

router.get('/summary', protect, authorize('hr_officer', 'admin'), getDashboardSummary);
router.get('/transfers', protect, authorize('hr_officer', 'admin'), getTransferReport);
router.get('/promotions', protect, authorize('hr_officer', 'admin'), getPromotionReport);
router.get('/credentials', protect, authorize('hr_officer', 'admin'), getCredentialReport);
router.get('/audit', protect, authorize('admin'), getAuditLog);
router.get('/teacher/:id/history', protect, authorize('hr_officer', 'admin'), getTeacherHistory);

module.exports = router;