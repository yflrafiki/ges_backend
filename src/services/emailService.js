const sgMail = require('@sendgrid/mail');

const sendgridConfigured = Boolean(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM);

if (sendgridConfigured) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const sendVerificationCode = async (toEmail, code) => {
  if (!sendgridConfigured) {
    console.log(`[email-verification] SendGrid not configured. Verification code for ${toEmail}: ${code}`);
    return;
  }

  try {
    await sgMail.send({
      from: process.env.SENDGRID_FROM,
      to: toEmail,
      subject: 'Your GES verification code',
      html: `
        <p>Welcome to GES. Use the code below to verify your email address:</p>
        <p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${code}</p>
        <p>This code expires in 15 minutes.</p>
      `,
    });
  } catch (err) {
    console.error('Failed to send verification code email:', err.response?.body?.errors || err.message);
  }
};

module.exports = { sendVerificationCode };
