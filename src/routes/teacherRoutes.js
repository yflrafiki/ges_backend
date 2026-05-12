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
const upload = require('../config/multer');

// Teacher routes
router.get('/profile', protect, authorize('teacher'), getMyProfile);
router.put('/profile', protect, authorize('teacher'),
  upload.single('passport_photo'), updateMyProfile);

// HR & Admin routes
router.get('/', protect, authorize('hr_officer', 'admin'), getAllTeachers);
router.get('/:id', protect, authorize('hr_officer', 'admin'), getTeacherById);
router.put('/:id', protect, authorize('hr_officer', 'admin'),
  upload.single('passport_photo'), updateTeacherById);

module.exports = router;