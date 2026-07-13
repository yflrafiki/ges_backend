const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const useDatabaseUrl = Boolean(process.env.DATABASE_URL);
const requiredDbEnv = useDatabaseUrl ? [] : ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missingDbEnv = requiredDbEnv.filter((key) => !process.env[key]);
if (missingDbEnv.length > 0) {
  console.error('Missing required database environment variables:', missingDbEnv.join(', '));
  process.exit(1);
}

const useSSL = Boolean(process.env.DB_HOST && process.env.DB_HOST.includes('render.com'));
const poolConfig = useDatabaseUrl
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    }
  : {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: useSSL ? { rejectUnauthorized: false } : undefined,
    };

const pool = new Pool(poolConfig);

console.log('Database config:', useDatabaseUrl ? 'DATABASE_URL' : `${process.env.DB_USER}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);

const initializeDatabase = async () => {
  // In production the schema is already applied — skip the round-trips to Neon.
  if (process.env.NODE_ENV === 'production') {
    console.log('Production mode — skipping schema init');
    return;
  }
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schemaSql);
    console.log('Database schema initialized');

    const migratePath = path.join(__dirname, 'migrate.sql');
    if (fs.existsSync(migratePath)) {
      const migrateSql = fs.readFileSync(migratePath, 'utf8');
      await pool.query(migrateSql);
      console.log('Database migrations applied');
    }
  } catch (err) {
    console.error('Database schema initialization failed:', err);
    process.exit(1);
  }
};

const dbReady = new Promise((resolve, reject) => {
  pool.connect(async (err, client, release) => {
    if (err) {
      console.error('Database connection error:', err.message);
      reject(err);
      return;
    }
    console.log('Connected to PostgreSQL database');
    console.log('Verified PostgreSQL connection');
    try {
      await initializeDatabase();
      resolve();
    } finally {
      release();
    }
  });
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err.message);
});

module.exports = pool;
module.exports.ready = dbReady;