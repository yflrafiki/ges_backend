const pool = require('../config/db');
const { sendPushToUser } = require('./pushService');

// Registry of currently-open SSE connections, per user — lets notifyUser()
// push a notification the instant it's created instead of the recipient
// having to wait for their next poll. In-memory only: fine for a single
// backend instance (this app isn't running multiple replicas), but a
// multi-instance deployment would need a shared pub/sub (e.g. Redis) instead.
const sseClients = new Map(); // userId -> Set<res>

const registerSSEClient = (userId, res) => {
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);
};

const unregisterSSEClient = (userId, res) => {
  const set = sseClients.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) sseClients.delete(userId);
};

const pushToSSEClients = (userId, event) => {
  const set = sseClients.get(userId);
  if (!set || set.size === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    res.write(payload);
  }
};

// Creates a single notification for one user, then pushes it live over SSE
// if they have an open connection. Fire-and-forget from the caller's
// perspective — failures are logged but never block the actual action
// (approving a transfer should never fail just because the notification
// insert did).
const notifyUser = async (userId, { type, title, message, link, entityType, entityId }) => {
  try {
    const result = await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, link, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, type, title, message || null, link || null, entityType || null, entityId || null]
    );
    pushToSSEClients(userId, result.rows[0]);
    // OS-level push so the notification still reaches the user even if
    // they don't have the app open in a browser tab right now.
    sendPushToUser(userId, { title, message, link });
  } catch (err) {
    console.error('Failed to create notification:', err.message);
  }
};

// HR officers and admins use different route prefixes for the same pages
// (/hr/... vs /admin/...) — a notification built with one or the other
// sends the wrong-role recipient to a route their account isn't authorized
// for, which bounces them to /login and looks exactly like being logged out
// even though their session is still perfectly valid.
const linkForRole = (link, role) => {
  if (!link) return link;
  if (role === 'admin') return link.replace(/^\/hr\//, '/admin/');
  if (role === 'hr_officer') return link.replace(/^\/admin\//, '/hr/');
  return link;
};

// Notifies every HR officer assigned to a given region, plus all admins
// (admins can act on anything regardless of region).
const notifyHrForRegion = async (region, payload) => {
  try {
    const result = await pool.query(
      `SELECT id, role FROM users WHERE (role = 'hr_officer' AND region = $1) OR role = 'admin'`,
      [region]
    );
    await Promise.all(result.rows.map((u) =>
      notifyUser(u.id, { ...payload, link: linkForRole(payload.link, u.role) })
    ));
  } catch (err) {
    console.error('Failed to notify HR for region:', err.message);
  }
};

// Notifies the teacher who owns a given teacher_id (looked up via their
// user_id), e.g. when HR/admin reviews their application.
const notifyTeacher = async (teacherId, payload) => {
  try {
    const result = await pool.query('SELECT user_id FROM teachers WHERE id = $1', [teacherId]);
    if (result.rows.length === 0) return;
    await notifyUser(result.rows[0].user_id, payload);
  } catch (err) {
    console.error('Failed to notify teacher:', err.message);
  }
};

module.exports = {
  notifyUser, notifyHrForRegion, notifyTeacher,
  registerSSEClient, unregisterSSEClient,
};
