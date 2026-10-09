const jwt = require('jsonwebtoken');
const pool = require('./db');
const { HttpError, COOKIE_NAME } = require('./lib/util');

// Loads the user from the DB on every request, so role and team changes take effect immediately.
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) throw new HttpError(401, 'Not authenticated.');

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      throw new HttpError(401, 'Session expired. Please log in again.');
    }

    const [[user]] = await pool.execute(
      'SELECT id, username, role, team_id FROM users WHERE id = ?',
      [payload.sub]
    );
    if (!user) throw new HttpError(401, 'Not authenticated.');

    req.user = { id: user.id, username: user.username, role: user.role, teamId: user.team_id };
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return next(new HttpError(403, 'Admins only.'));
  next();
}

function requireTeam(req, res, next) {
  if (!req.user?.teamId) return next(new HttpError(403, 'Join a team first.'));
  next();
}

module.exports = { requireAuth, requireAdmin, requireTeam };
