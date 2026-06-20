process.on('uncaughtException', (err) => console.error('UNCAUGHT ERROR:', err));
process.on('unhandledRejection', (err) => console.error('UNHANDLED REJECTION:', err));

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const multer = require('multer');
require('dotenv').config();

const useDatabaseUrl = Boolean(process.env.DATABASE_URL);
const requiredEnv = useDatabaseUrl
  ? ['JWT_SECRET', 'JWT_EXPIRES_IN']
  : [
      'DB_HOST',
      'DB_PORT',
      'DB_NAME',
      'DB_USER',
      'DB_PASSWORD',
      'JWT_SECRET',
      'JWT_EXPIRES_IN',
    ];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.error('Missing required environment variables:', missingEnv.join(', '));
  process.exit(1);
}

const authRoutes = require('./src/routes/authRoutes');
const teacherRoutes = require('./src/routes/teacherRoutes');
const transferRoutes = require('./src/routes/transferRoutes');
const promotionRoutes = require('./src/routes/promotionRoutes');
const documentRoutes = require('./src/routes/documentRoutes');
const credentialRoutes = require('./src/routes/credentialRoutes');
const reportRoutes = require('./src/routes/reportRoutes');
const examRoutes = require('./src/routes/examRoutes');
const changeRequestRoutes = require('./src/routes/changeRequestRoutes');
const blockchainReferenceRoutes = require('./src/routes/blockchainReferenceRoutes');
const path = require('path')

const app = express();

// Middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const allowedOrigins = [
  'https://gesadmin.vercel.app',
  'https://gesteachers.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const isLocalDevOrigin = (origin) =>
  /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || isLocalDevOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS policy does not allow access from origin ${origin}`));
  },
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/teachers', teacherRoutes);
app.use('/api/transfers', transferRoutes);
app.use('/api/promotions', promotionRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/credentials', credentialRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/change-requests', changeRequestRoutes);
app.use('/api/blockchain', blockchainReferenceRoutes);
// Only profile photos are public (plain <img> tags can't send auth headers).
// Certificates/documents are never served statically — see GET /api/documents/:id/file.
app.use('/uploads/photos', express.static(path.join(__dirname, 'src/uploads/photos')));

// Test route
app.get('/', (req, res) => {
  res.json({ message: 'GES Backend API is running' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: err.message });
  }

  if (err.message && err.message.includes('File type not allowed')) {
    return res.status(415).json({ message: err.message });
  }

  res.status(500).json({ message: 'Something went wrong', error: err.message });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});