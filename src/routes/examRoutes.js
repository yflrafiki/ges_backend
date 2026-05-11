const express = require('express');
const router = express.Router();
const {
  createExam,
  publishExam,
  closeExam,
  getAllExams,
  getAvailableExams,
  getExamQuestions,
  submitExam,
  getExamResults
} = require('../controllers/examController');
const { protect, authorize } = require('../middleware/auth');

// HR & Admin routes
router.post('/', protect, authorize('hr_officer', 'admin'), createExam);
router.put('/:id/publish', protect, authorize('hr_officer', 'admin'), publishExam);
router.put('/:id/close', protect, authorize('hr_officer', 'admin'), closeExam);
router.get('/', protect, authorize('hr_officer', 'admin'), getAllExams);
router.get('/:id/results', protect, authorize('hr_officer', 'admin'), getExamResults);

// Teacher routes
router.get('/available', protect, authorize('teacher'), getAvailableExams);
router.get('/:id/questions', protect, authorize('teacher'), getExamQuestions);
router.post('/:id/submit', protect, authorize('teacher'), submitExam);

module.exports = router;