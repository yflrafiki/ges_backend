const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
require('dotenv').config();

const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
};

// @route  POST /api/auth/register
const register = async (req, res) => {
  console.log('BODY RECEIVED:', req.body);

  const { email, password, role, staff_id, first_name, last_name, phone, gender,
    subject_specialization, current_grade, current_school,
    current_district, current_region, qualification } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  if (!role) {
    return res.status(400).json({ message: 'Role is required' });
  }

  // Validate role
  const allowedRoles = ['teacher', 'hr_officer', 'admin', 'examiner'];
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ message: 'Invalid role' });
  }

  if (role === 'teacher' && (!staff_id || !first_name || !last_name)) {
    return res.status(400).json({ message: 'staff_id, first_name and last_name are required for teachers' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const userResult = await pool.query(
      'INSERT INTO users (email, password, role) VALUES ($1, $2, $3) RETURNING id, email, role',
      [email, hashedPassword, role]
    );
    const user = userResult.rows[0];

    if (user.role === 'teacher') {
      await pool.query(
        `INSERT INTO teachers 
          (user_id, staff_id, first_name, last_name, phone, gender,
          subject_specialization, current_grade, current_school,
          current_district, current_region, qualification)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [user.id, staff_id, first_name, last_name, phone || null, gender || null,
          subject_specialization || null, current_grade || null, current_school || null,
          current_district || null, current_region || null, qualification || null]
      );
    }

    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, details) VALUES ($1, $2, $3, $4)',
      [user.id, 'REGISTER', 'users', `New ${user.role} registered`]
    );

    const token = generateToken(user);

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: { id: user.id, email: user.email, role: user.role }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  POST /api/auth/login
const login = async (req, res) => {
  console.log('LOGIN BODY:', req.body);
  const { email, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
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

module.exports = { register, login, getMe, changePassword };