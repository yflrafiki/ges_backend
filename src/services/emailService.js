const sgMail = require('@sendgrid/mail');

const sendgridConfigured = Boolean(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM);

if (sendgridConfigured) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const FROM = {
  email: process.env.SENDGRID_FROM,
  name: 'GES Portal',
};

function codeTemplate(heading, bodyText, code, footerText) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#1a3e72;padding:24px 32px;">
            <p style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">Ghana Education Service</p>
            <p style="margin:4px 0 0;color:#a8bfd6;font-size:13px;">Teacher Management Portal</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:22px;font-weight:bold;color:#1a3e72;">${heading}</p>
            <p style="margin:0 0 24px;font-size:15px;color:#444444;line-height:1.6;">${bodyText}</p>
            <!-- Code box -->
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
              <tr>
                <td style="background:#f0f4fa;border:2px dashed #1a3e72;border-radius:8px;padding:18px 40px;text-align:center;">
                  <span style="font-size:36px;font-weight:bold;letter-spacing:10px;color:#1a3e72;">${code}</span>
                </td>
              </tr>
            </table>
            <p style="margin:0;font-size:13px;color:#888888;">${footerText}</p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f4f6f8;padding:16px 32px;border-top:1px solid #e8edf2;">
            <p style="margin:0;font-size:12px;color:#aaaaaa;text-align:center;">
              This is an automated message from the GES Teacher Management Portal. Do not reply to this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const sendVerificationCode = async (toEmail, code) => {
  if (!sendgridConfigured) {
    console.log(`[email-verification] SendGrid not configured. Code for ${toEmail}: ${code}`);
    return;
  }

  try {
    await sgMail.send({
      from: FROM,
      to: toEmail,
      subject: 'GES Portal — Email Verification Code',
      text: `Your GES email verification code is: ${code}\n\nThis code expires in 15 minutes.`,
      html: codeTemplate(
        'Verify your email address',
        'Welcome to the GES Teacher Management Portal. Enter the code below to verify your email address and activate your account.',
        code,
        'This code expires in 15 minutes. If you did not create a GES account, you can safely ignore this email.'
      ),
    });
  } catch (err) {
    console.error('Failed to send verification email:', err.response?.body?.errors || err.message);
  }
};

const sendPasswordResetCode = async (toEmail, code) => {
  if (!sendgridConfigured) {
    console.log(`[password-reset] SendGrid not configured. Code for ${toEmail}: ${code}`);
    return;
  }

  try {
    await sgMail.send({
      from: FROM,
      to: toEmail,
      subject: 'GES Portal — Password Reset Code',
      text: `Your GES password reset code is: ${code}\n\nThis code expires in 15 minutes. If you did not request this, ignore this email.`,
      html: codeTemplate(
        'Reset your password',
        'A password reset was requested for your GES Portal account. Use the code below to set a new password.',
        code,
        'This code expires in 15 minutes. If you did not request a password reset, you can safely ignore this email — your account remains secure.'
      ),
    });
  } catch (err) {
    console.error('Failed to send password reset email:', err.response?.body?.errors || err.message);
  }
};

module.exports = { sendVerificationCode, sendPasswordResetCode };
