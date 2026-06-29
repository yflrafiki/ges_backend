const webpush = require('web-push');
const pool = require('../config/db');

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const pushConfigured = Boolean(vapidPublicKey && vapidPrivateKey);

if (pushConfigured) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@ges.gov.gh',
    vapidPublicKey,
    vapidPrivateKey
  );
} else {
  console.log('[push] VAPID keys not configured — push notifications disabled (in-app/SSE notifications still work)');
}

// Sends a real OS-level push notification to every device/browser the user
// has subscribed on. Best-effort and silent: a missing/invalid subscription
// should never block the notification from being saved in-app (notifyUser
// already did that before calling this) — a 404/410 from the push service
// just means that subscription is dead, so we clean it up.
const sendPushToUser = async (userId, { title, message, link }) => {
  if (!pushConfigured) return;

  try {
    const subs = await pool.query('SELECT * FROM push_subscriptions WHERE user_id = $1', [userId]);
    if (subs.rows.length === 0) return;

    const payload = JSON.stringify({ title, body: message || '', link: link || '/' });

    await Promise.all(subs.rows.map(async (sub) => {
      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      try {
        await webpush.sendNotification(subscription, payload);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
        } else {
          console.error('Push send failed:', err.message);
        }
      }
    }));
  } catch (err) {
    console.error('Failed to send push notification:', err.message);
  }
};

module.exports = { vapidPublicKey, sendPushToUser };
