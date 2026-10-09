const router = require('express').Router();
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const { requireAuth } = require('../middleware');
const {
  HttpError,
  EMAIL_RE,
  USERNAME_RE,
  issueToken,
  clearToken,
  toStr,
} = require('../lib/util');

// Constant-cost comparison for unknown emails, so response time doesn't reveal account existence
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 12);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
});

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const email = toStr(req.body.email, 1, 255, 'Email').toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Only @gmail.com addresses are accepted.');

    const username = toStr(req.body.username, 3, 32, 'Username');
    if (!USERNAME_RE.test(username)) {
      throw new HttpError(400, 'Username may contain letters, numbers, _ . - only.');
    }

    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (password.length < 8 || Buffer.byteLength(password) > 72) {
      throw new HttpError(400, 'Password must be 8-72 bytes.');
    }

    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute(
      'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
      [email, username, hash]
    );

    issueToken(res, result.insertId);
    res.status(201).json({ id: result.insertId, username, role: 'user' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return next(new HttpError(409, 'Email or username already in use.'));
    next(err);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const email = toStr(req.body.email, 1, 255, 'Email').toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    const [[user]] = await pool.execute(
      'SELECT id, username, role, password_hash FROM users WHERE email = ?',
      [email]
    );
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, 'Invalid email or password.');

    issueToken(res, user.id);
    res.json({ id: user.id, username: user.username, role: user.role });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  clearToken(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const uid = req.user.id;
    const [[user]] = await pool.execute(
      'SELECT id, email, username, role, team_id FROM users WHERE id = ?',
      [uid]
    );

    let team = null;
    let solves = [];
    let pendingRequests = [];

    if (req.user.teamId) {
      const [[t]] = await pool.execute(
        'SELECT id, name, captain_id, profile_photo FROM teams WHERE id = ?',
        [req.user.teamId]
      );
      if (t) {
        team = {
          id: t.id,
          name: t.name,
          profile_photo: t.profile_photo,
          is_captain: t.captain_id === uid,
        };
        const [solveRows] = await pool.execute(
          `SELECT c.title, e.name AS event_name, s.points_awarded, s.solved_at
           FROM solves s
           JOIN challenges c ON c.id = s.challenge_id
           JOIN events e ON e.id = s.event_id
           WHERE s.team_id = ?
           ORDER BY s.solved_at DESC`,
          [t.id]
        );
        solves = solveRows;

        if (team.is_captain) {
          const [reqRows] = await pool.execute(
            `SELECT r.id, u.username, r.created_at
             FROM team_requests r JOIN users u ON u.id = r.user_id
             WHERE r.team_id = ? AND r.type = 'request' AND r.status = 'pending'
             ORDER BY r.created_at`,
            [t.id]
          );
          pendingRequests = reqRows;
        }
      }
    }

    const [invites] = await pool.execute(
      `SELECT r.id, r.team_id, t.name AS team_name
       FROM team_requests r JOIN teams t ON t.id = r.team_id
       WHERE r.user_id = ? AND r.type = 'invite' AND r.status = 'pending'`,
      [uid]
    );

    res.json({ user, team, invites, solves, pending_requests: pendingRequests });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
