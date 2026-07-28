const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '../uploads');

// Profile photos are served publicly (plain <img> tags, lower sensitivity).
// Everything else (certificates, supporting documents) is sensitive — those
// live in a separate subfolder that is NOT statically served; access goes
// through an authenticated endpoint (see documentController.getDocumentFile).
const PHOTOS_DIR = path.join(uploadDir, 'photos');
const DOCUMENTS_DIR = path.join(uploadDir, 'documents');
for (const dir of [PHOTOS_DIR, DOCUMENTS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, file.fieldname === 'passport_photo' ? PHOTOS_DIR : DOCUMENTS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
  ];

  const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed. Only PDF and images (JPG, PNG) are accepted.`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

module.exports = upload;
