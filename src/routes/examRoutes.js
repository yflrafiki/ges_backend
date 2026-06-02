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
  getExamResults,
  getMyExamResult
} = require('../controllers/examController');
const { protect, authorize } = require('../middleware/auth');

const ensureTeacherProfile = require('../middleware/ensureTeacherProfile');

// Static routes first (must come before /:id to avoid shadowing)
router.get('/', protect, authorize('hr_officer', 'admin', 'examiner'), getAllExams);
router.get('/available', protect, authorize('teacher'), ensureTeacherProfile, getAvailableExams);

// Examiner — create and manage
router.post('/', protect, authorize('examiner'), createExam);
router.put('/:id/publish', protect, authorize('examiner'), publishExam);
router.put('/:id/close', protect, authorize('examiner'), closeExam);

// Results — HR, Admin, and Examiner can all view
router.get('/:id/results', protect, authorize('hr_officer', 'admin', 'examiner'), getExamResults);

// Dynamic teacher routes
router.get('/:id/my-result', protect, authorize('teacher'), ensureTeacherProfile, getMyExamResult);
router.get('/:id/questions', protect, authorize('teacher'), ensureTeacherProfile, getExamQuestions);
router.post('/:id/submit', protect, authorize('teacher'), ensureTeacherProfile, submitExam);

module.exports = router;