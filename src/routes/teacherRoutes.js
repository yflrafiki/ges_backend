const express = require('express');
const router = express.Router();
const {
  getMyProfile,
  updateMyProfile,
  getAllTeachers,
  getTeacherById,
  updateTeacherById
} = require('../controllers/teacherController');
const { protect, authorize } = require('../middleware/auth');

// Teacher routes (teacher only)
router.get('/profile', protect, authorize('teacher'), getMyProfile);
router.put('/profile', protect, authorize('teacher'), updateMyProfile);

// HR & Admin routes
router.get('/', protect, authorize('hr_officer', 'admin'), getAllTeachers);
router.get('/:id', protect, authorize('hr_officer', 'admin'), getTeacherById);
router.put('/:id', protect, authorize('hr_officer', 'admin'), updateTeacherById);

module.exports = router;