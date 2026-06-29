const pool = require('../config/db');
const { vapidPublicKey } = require('../services/pushService');

// @route  GET /api/push/public-key
// @access Public — VAPID public keys are meant to be exposed to clients,
// that's how the browser's Push API verifies the server is who it says it is.
const getPublicKey = (req, res) => {
  if (!vapidPublicKey) {
    return res.status(503).json({ message: 'Push notifications are not configured on this server' });
  }
  res.json({ publicKey: vapidPublicKey });
};

// @route  POST /api/push/subscribe
// @access Authenticated
const subscribe = async (req, res) => {
  const { endpoint, keys } = req.body || {};

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ message: 'A valid push subscription (endpoint, keys.p256dh, keys.auth) is required' });
  }

  try {
    // Re-subscribing with the same endpoint (e.g. after permission was
    // re-granted) should just refresh the keys, not create a duplicate row.
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4`,
      [req.user.id, endpoint, keys.p256dh, keys.auth]
    );
    res.status(201).json({ message: 'Subscribed to push notifications' });
  } catch (err) {
    console.error('Failed to save push subscription:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  POST /api/push/unsubscribe
// @access Authenticated
const unsubscribe = async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) {
    return res.status(400).json({ message: 'endpoint is required' });
  }

  try {
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, req.user.id]);
    res.json({ message: 'Unsubscribed from push notifications' });
  } catch (err) {
    console.error('Failed to remove push subscription:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = { getPublicKey, subscribe, unsubscribe };
