const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/db');
const { sendVerificationEmail } = require('../services/emailService');
require('dotenv').config();

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
  } = req.body;

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

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');

    const userResult = await client.query(
      `INSERT INTO users (email, password, role, region, district, email_verification_token, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, role, region, district`,
      [
        normalizedEmail, hashedPassword, normalizedRole,
        normalizedRole === 'hr_officer' ? nullable(region) : null,
        normalizedRole === 'hr_officer' ? nullable(district) : null,
        emailVerificationToken,
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

    sendVerificationEmail(user.email, emailVerificationToken);

    const token = generateToken(user);

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: { id: user.id, email: user.email, role: user.role, region: user.region, district: user.district }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('REGISTER ERROR:', err.stack || err);
    console.error('REGISTER BODY:', {
      email: req.body.email,
      role: req.body.role,
      staff_id: req.body.staff_id,
      first_name: req.body.first_name,
      last_name: req.body.last_name,
    });
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
};

// @route  POST /api/auth/login
const login = async (req, res) => {
  console.log('LOGIN BODY:', req.body);
  const { email, password } = req.body;
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

// @route  POST /api/auth/verify-email
const verifyEmail = async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ message: 'Verification token is required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, email_verified FROM users WHERE email_verification_token = $1',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired verification token' });
    }

    if (result.rows[0].email_verified) {
      return res.json({ message: 'Email already verified' });
    }

    await pool.query(
      `UPDATE users SET email_verified = true, email_verified_at = NOW(), email_verification_token = NULL
       WHERE id = $1`,
      [result.rows[0].id]
    );

    res.json({ message: 'Email verified successfully' });
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

module.exports = { register, login, getMe, changePassword, verifyEmail, getUsersByRole };