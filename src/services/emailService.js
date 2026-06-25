const nodemailer = require('nodemailer');

const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      // Some hosts (e.g. Render) have broken/missing IPv6 egress, which makes
      // connections to providers whose SMTP resolves to both A and AAAA records
      // (like Gmail) fail with ENETUNREACH. Force IPv4 to avoid that.
      family: 4,
    })
  : null;

const sendVerificationCode = async (toEmail, code) => {
  if (!transporter) {
    console.log(`[email-verification] SMTP not configured. Verification code for ${toEmail}: ${code}`);
    return;
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: toEmail,
      subject: 'Your GES verification code',
      html: `
        <p>Welcome to GES. Use the code below to verify your email address:</p>
        <p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${code}</p>
        <p>This code expires in 15 minutes.</p>
      `,
    });
  } catch (err) {
    console.error('Failed to send verification code email:', err.message);
  }
};

module.exports = { sendVerificationCode };
