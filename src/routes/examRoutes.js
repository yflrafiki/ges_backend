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

// Examiner only — create and manage exams
router.post('/', protect, authorize('examiner'), createExam);
router.put('/:id/publish', protect, authorize('examiner'), publishExam);
router.put('/:id/close', protect, authorize('examiner'), closeExam);
router.get('/:id/results', protect, authorize('examiner', 'admin'), getExamResults);

// HR, Admin and Examiner — view exams
router.get('/', protect, authorize('hr_officer', 'admin', 'examiner'), getAllExams);

const ensureTeacherProfile = require('../middleware/ensureTeacherProfile');

// Teacher routes
router.get('/available', protect, authorize('teacher'), ensureTeacherProfile, getAvailableExams);
router.get('/:id/my-result', protect, authorize('teacher'), ensureTeacherProfile, getMyExamResult);
router.get('/:id/questions', protect, authorize('teacher'), ensureTeacherProfile, getExamQuestions);
router.post('/:id/submit', protect, authorize('teacher'), ensureTeacherProfile, submitExam);

module.exports = router;