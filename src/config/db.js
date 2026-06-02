const { Pool } = require('pg');
require('dotenv').config();

const requiredDbEnv = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missingDbEnv = requiredDbEnv.filter((key) => !process.env[key]);
if (missingDbEnv.length > 0) {
  console.error('Missing required database environment variables:', missingDbEnv.join(', '));
  process.exit(1);
}

const useSSL = process.env.NODE_ENV === 'production' || (process.env.DB_HOST && process.env.DB_HOST.includes('render.com'));
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('Connected to PostgreSQL database');
    console.log('Verified PostgreSQL connection');
    release();
  }
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err.message);
});

module.exports = pool;