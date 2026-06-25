const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/db');
const { sendVerificationCode } = require('../services/emailService');
require('dotenv').config();

const CODE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

const generateVerificationCode = () => String(crypto.randomInt(100000, 1000000));

const generateToken = (user) => {
  const secret = process.env.JWT_SECRET;
  const expiresIn = process.env.JWT_EXPIRES_IN;
  if (!secret || !expiresIn) {
    throw new Error('JWT_SECRET and JWT_EXPIRES_IN must be configured');
  }
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, region: user.region || null, district: user.district || null },
    secret,
    { expiresIn }
  );
};

// @route  POST /api/auth/register
// @access Admin only
const register = async (req, res) => {
  console.log('BODY RECEIVED:', req.body);

  const nullable = (value) => value === '' ? null : value;

  const {
    email, password, role,
    // HR scoping
    region, district,
    // Basic
    staff_id, first_name, last_name, date_of_birth,
    phone, gender, qualification,
    subject_specialization, current_grade, current_school,
    current_district, current_region,
    // Personal
    title, marital_status, nationality, hometown, house_number,
    // Identification
    ghana_card_number, ghana_card_issue_date, ghana_card_expiry_date,
    // Rank
    national_date_of_present_rank, years_in_current_rank,
    // Employment
    date_of_first_appointment, date_of_confirmation,
    date_of_current_posting, employment_status,
    // Health
    disability_status, disability_type,
    // Service
    years_of_service
  } = req.body || {};

  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedRole = String(role || '').trim().toLowerCase();

  if (!normalizedEmail || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  if (!normalizedRole) {
    return res.status(400).json({ message: 'Role is required' });
  }

  // Validate role
  const allowedRoles = ['teacher', 'hr_officer', 'admin', 'examiner'];
  if (!allowedRoles.includes(normalizedRole)) {
    return res.status(400).json({ message: 'Invalid role' });
  }

  if (normalizedRole === 'teacher' && (!staff_id || !first_name || !last_name)) {
    return res.status(400).json({ message: 'staff_id, first_name and last_name are required for teachers' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Email already registered' });
    }

    if (normalizedRole === 'teacher' && staff_id) {
      const existingStaffId = await client.query('SELECT id FROM teachers WHERE staff_id = $1', [staff_id]);
      if (existingStaffId.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `Staff ID '${staff_id}' is already in use` });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const verificationCode = generateVerificationCode();
    const codeExpiresAt = new Date(Date.now() + CODE_EXPIRY_MS);

    const userResult = await client.query(
      `INSERT INTO users (email, password, role, region, district, email_verification_code, email_verification_code_expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, email, role, region, district`,
      [
        normalizedEmail, hashedPassword, normalizedRole,
        normalizedRole === 'hr_officer' ? nullable(region) : null,
        normalizedRole === 'hr_officer' ? nullable(district) : null,
        verificationCode,
        codeExpiresAt,
        req.user ? req.user.id : null
      ]
    );
    const user = userResult.rows[0];

    if (user.role === 'teacher') {
      await client.query(
        `INSERT INTO teachers
          (user_id, staff_id, first_name, last_name, phone, gender,
          subject_specialization, current_grade, current_school,
          current_district, current_region, qualification,
          title, marital_status, nationality, hometown, house_number,
          ghana_card_number, ghana_card_issue_date, ghana_card_expiry_date,
          national_date_of_present_rank, years_in_current_rank,
          date_of_first_appointment, date_of_confirmation,
          date_of_current_posting, employment_status,
          disability_status, disability_type,
          years_of_service, date_of_birth)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
                 $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)`,
        [
          user.id,
          nullable(staff_id),
          nullable(first_name),
          nullable(last_name),
          nullable(phone),
          nullable(gender),
          nullable(subject_specialization),
          nullable(current_grade),
          nullable(current_school),
          nullable(current_district),
          nullable(current_region),
          nullable(qualification),
          nullable(title),
          nullable(marital_status),
          nullable(nationality),
          nullable(hometown),
          nullable(house_number),
          nullable(ghana_card_number),
          nullable(ghana_card_issue_date),
          nullable(ghana_card_expiry_date),
          nullable(national_date_of_present_rank),
          years_in_current_rank || 0,
          nullable(date_of_first_appointment),
          nullable(date_of_confirmation),
          nullable(date_of_current_posting),
          nullable(employment_status) || 'active',
          disability_status === 'true' || disability_status === true || false,
          nullable(disability_type),
          years_of_service || 0,
          nullable(date_of_birth)
        ]
      );
    }

    await client.query(
      'INSERT INTO audit_logs (user_id, action, entity, details) VALUES ($1, $2, $3, $4)',
      [req.user ? req.user.id : user.id, 'REGISTER', 'users',
        `New ${user.role} account created${req.user ? ` by admin ${req.user.email}` : ''}: ${user.email}`]
    );

    await client.query('COMMIT');

    sendVerificationCode(user.email, verificationCode);

    res.status(201).json({
      message: 'Registration successful. A verification code has been sent to the account email.',
      user: { id: user.id, email: user.email, role: user.role, region: user.region, district: user.district }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('REGISTER ERROR:', err.stack || err);
    console.error('REGISTER BODY:', {
      email: req.body?.email,
      role: req.body?.role,
      staff_id: req.body?.staff_id,
      first_name: req.body?.first_name,
      last_name: req.body?.last_name,
    });

    // Postgres unique_violation — covers constraints not pre-checked above
    // (e.g. ghana_card_number) so a duplicate value never surfaces as a 500.
    if (err.code === '23505') {
      return res.status(400).json({ message: 'A record with one of these unique values (e.g. staff ID, Ghana Card number) already exists' });
    }

    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
};

// @route  POST /api/auth/login
const login = async (req, res) => {
  console.log('LOGIN BODY:', req.body);
  const { email, password } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!user.email_verified) {
      // Password was correct, but no session is issued until the email is
      // verified. Only send a fresh code if the existing one has expired (or
      // none exists) — repeated login attempts within the window shouldn't
      // spam a new email each time. The "Resend code" button covers that case.
      const hasValidCode = user.email_verification_code_expires_at
        && new Date(user.email_verification_code_expires_at) > new Date();

      if (!hasValidCode) {
        const verificationCode = generateVerificationCode();
        const codeExpiresAt = new Date(Date.now() + CODE_EXPIRY_MS);
        await pool.query(
          'UPDATE users SET email_verification_code = $1, email_verification_code_expires_at = $2 WHERE id = $3',
          [verificationCode, codeExpiresAt, user.id]
        );
        sendVerificationCode(user.email, verificationCode);
      }

      return res.status(403).json({
        message: 'Email not verified. A verification code has been sent to your email.',
        email_verification_required: true,
        email: user.email
      });
    }

    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, details) VALUES ($1, $2, $3, $4)',
      [user.id, 'LOGIN', 'users', `${user.role} logged in`]
    );

    const token = generateToken(user);

    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, email: user.email, role: user.role }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/auth/me
const getMe = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  PUT /api/auth/change-password
const changePassword = async (req, res) => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ message: 'Current and new password are required' });
  }

  if (new_password.length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(current_password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(new_password, salt);

    await pool.query(
      'UPDATE users SET password = $1 WHERE id = $2',
      [hashedPassword, req.user.id]
    );

    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, details) VALUES ($1,$2,$3,$4)',
      [req.user.id, 'CHANGE_PASSWORD', 'users', 'User changed their password']
    );

    res.json({ message: 'Password changed successfully' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  POST /api/auth/verify-email-code
// @access Public — identified by email + the code sent to that email
// Verifies and immediately logs the user in (returns a token), so they don't
// have to submit the code then separately log in again right after.
const verifyEmailCode = async (req, res) => {
  const { email, code } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!normalizedEmail || !code) {
    return res.status(400).json({ message: 'Email and code are required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid email or code' });
    }

    const user = result.rows[0];

    if (user.email_verified) {
      return res.status(400).json({ message: 'Email already verified — please log in' });
    }

    if (!user.email_verification_code || user.email_verification_code !== String(code).trim()) {
      return res.status(400).json({ message: 'Invalid code' });
    }

    if (!user.email_verification_code_expires_at || new Date(user.email_verification_code_expires_at) < new Date()) {
      return res.status(400).json({ message: 'This code has expired. Request a new one.' });
    }

    await pool.query(
      `UPDATE users SET email_verified = true, email_verified_at = NOW(),
        email_verification_code = NULL, email_verification_code_expires_at = NULL
       WHERE id = $1`,
      [user.id]
    );

    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, details) VALUES ($1,$2,$3,$4)',
      [user.id, 'VERIFY_EMAIL', 'users', 'Email verified via code']
    );

    const token = generateToken(user);

    res.json({
      message: 'Email verified successfully',
      token,
      user: { id: user.id, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  POST /api/auth/resend-verification-code
// @access Public — identified by email only
const resendVerificationCode = async (req, res) => {
  const { email } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!normalizedEmail) {
    return res.status(400).json({ message: 'Email is required' });
  }

  try {
    const result = await pool.query('SELECT id, email, email_verified FROM users WHERE email = $1', [normalizedEmail]);
    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'No account found with that email' });
    }

    const user = result.rows[0];

    if (user.email_verified) {
      return res.status(400).json({ message: 'Email already verified — please log in' });
    }

    const verificationCode = generateVerificationCode();
    const codeExpiresAt = new Date(Date.now() + CODE_EXPIRY_MS);

    await pool.query(
      'UPDATE users SET email_verification_code = $1, email_verification_code_expires_at = $2 WHERE id = $3',
      [verificationCode, codeExpiresAt, user.id]
    );

    sendVerificationCode(user.email, verificationCode);

    res.json({ message: 'A new verification code has been sent to your email' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/auth/users?role=hr_officer&region=Greater%20Accra
// @access Admin only
const getUsersByRole = async (req, res) => {
  try {
    const { role, region } = req.query;

    if (!role) {
      return res.status(400).json({ message: 'role query parameter is required' });
    }

    let query = 'SELECT id, email, role, region, district, created_at FROM users WHERE role = $1';
    const params = [role];

    if (region) {
      query += ' AND region = $2';
      params.push(region);
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json({ count: result.rows.length, users: result.rows });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = { register, login, getMe, changePassword, verifyEmailCode, resendVerificationCode, getUsersByRole };