const nodemailer = require('nodemailer');

const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

const buildVerificationLink = (token) => {
  const base = process.env.APP_BASE_URL || 'http://localhost:5173';
  return `${base}/verify-email?token=${token}`;
};

const sendVerificationEmail = async (toEmail, token) => {
  const link = buildVerificationLink(token);

  if (!transporter) {
    console.log(`[email-verification] SMTP not configured. Verification link for ${toEmail}: ${link}`);
    return;
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: toEmail,
      subject: 'Verify your GES account email',
      html: `<p>Welcome to GES. Please verify your email by clicking the link below:</p><p><a href="${link}">${link}</a></p>`,
    });
  } catch (err) {
    console.error('Failed to send verification email:', err.message);
  }
};

module.exports = { sendVerificationEmail };
