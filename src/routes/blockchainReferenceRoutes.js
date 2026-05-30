const express = require('express');
const router = express.Router();
const {
  uploadReference,
  getAllReferences
} = require('../controllers/blockchainReferenceController');
const { protect, authorize } = require('../middleware/auth');
const upload = require('../config/multer');

router.post('/upload-reference',
  protect,
  authorize('hr_officer', 'admin'),
  upload.single('document'),
  uploadReference
);

router.get('/references',
  protect,
  authorize('hr_officer', 'admin'),
  getAllReferences
);

module.exports = router;