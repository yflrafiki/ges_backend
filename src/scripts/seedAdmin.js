const bcrypt = require('bcryptjs');
const pool = require('../config/db');
require('dotenv').config();

// Creates the first admin account so it can log in and create everyone else.
// Run once: pnpm seed:admin
const seedAdmin = async () => {
  const email = String(process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in your .env before running this script');
    process.exit(1);
  }

  try {
    await pool.ready;
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      console.log(`User ${email} already exists — skipping`);
      process.exit(0);
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await pool.query(
      `INSERT INTO users (email, password, role, email_verified, email_verified_at)
       VALUES ($1, $2, 'admin', true, NOW())`,
      [email, hashedPassword]
    );

    console.log(`Admin account created: ${email}`);
    process.exit(0);
  } catch (err) {
    console.error('Failed to seed admin account:', err.message);
    process.exit(1);
  }
};

seedAdmin();
