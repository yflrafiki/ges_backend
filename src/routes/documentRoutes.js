const express = require('express');
const router = express.Router();
const {
  uploadDocument,
  getMyDocuments,
  getDocumentById,
  getTeacherDocuments
} = require('../controllers/documentController');
const { protect, authorize } = require('../middleware/auth');
const upload = require('../config/multer');

// Teacher routes
router.post('/upload', protect, authorize('teacher'), upload.single('document'), uploadDocument);
router.get('/my', protect, authorize('teacher'), getMyDocuments);

// HR & Admin routes
router.get('/teacher/:teacherId', protect, authorize('hr_officer', 'admin'), getTeacherDocuments);

// Mixed access
router.get('/:id', protect, authorize('teacher', 'hr_officer', 'admin'), getDocumentById);

module.exports = router;