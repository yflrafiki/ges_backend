const pool = require('../config/db');
const { registerSSEClient, unregisterSSEClient } = require('../services/notificationService');

// @route  GET /api/notifications/stream
// @access Any authenticated user (token via ?token= query param — see protectSSE)
// Server-Sent Events: keeps the connection open and pushes each new
// notification the instant it's created, instead of the frontend having to
// poll and wait. One-directional (server -> client), so no extra library
// needed — just a long-lived HTTP response that's never closed.
const streamNotifications = (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 5000\n\n');

  registerSSEClient(req.user.id, res);

  // Keeps intermediary proxies (Render, Cloudflare, etc.) from timing out an
  // idle connection and silently dropping it.
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unregisterSSEClient(req.user.id, res);
  });
};

// @route  GET /api/notifications
// @access Any authenticated user — their own notifications only
const getMyNotifications = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json({ notifications: result.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/notifications/unread-count
// @access Any authenticated user — cheap endpoint for frequent polling
const getUnreadCount = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read = false`,
      [req.user.id]
    );
    res.json({ count: parseInt(result.rows[0].count, 10) });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  PUT /api/notifications/:id/read
// @access Any authenticated user — only their own notification
const markAsRead = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    res.json({ notification: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  PUT /api/notifications/read-all
// @access Any authenticated user
const markAllAsRead = async (req, res) => {
  try {
    await pool.query(`UPDATE notifications SET read = true WHERE user_id = $1 AND read = false`, [req.user.id]);
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = { getMyNotifications, getUnreadCount, markAsRead, markAllAsRead, streamNotifications };
