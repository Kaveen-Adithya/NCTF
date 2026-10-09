const router = require('express').Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const { requireAuth, requireTeam } = require('../middleware');
const { HttpError, hmacFlag, parseId } = require('../lib/util');

const submitLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `team:${req.user.teamId}`,
  message: { error: 'Too many submissions. Slow down.' },
});

// db is either the pool or a transaction connection; both expose execute()
async function loadContext(db, challengeId, teamId) {
  const [[ctx]] = await db.execute(
    `SELECT c.id, c.event_id, c.title, c.description, c.category, c.flag_hmac, c.point_value,
            (UTC_TIMESTAMP() >= e.start_time AND UTC_TIMESTAMP() < e.end_time) AS is_live,
            (er.team_id IS NOT NULL) AS registered
     FROM challenges c
     JOIN events e ON e.id = c.event_id
     LEFT JOIN event_registrations er ON er.event_id = c.event_id AND er.team_id = ?
     WHERE c.id = ?`,
    [teamId, challengeId]
  );
  if (!ctx) throw new HttpError(404, 'Challenge not found.');
  if (!ctx.registered) throw new HttpError(403, 'Your team is not registered for this event.');
  ctx.is_live = Boolean(ctx.is_live);
  return ctx;
}

function requireLive(ctx) {
  if (!ctx.is_live) throw new HttpError(403, 'Event is not live.');
}

// Conditional UPDATE is atomic: it fails instead of going negative
async function debit(conn, teamId, eventId, amount) {
  const [r] = await conn.execute(
    'UPDATE team_event_balances SET balance = balance - ? WHERE team_id = ? AND event_id = ? AND balance >= ?',
    [amount, teamId, eventId, amount]
  );
  if (r.affectedRows !== 1) throw new HttpError(402, 'Not enough points.');
}

async function credit(conn, teamId, eventId, amount) {
  await conn.execute(
    `INSERT INTO team_event_balances (team_id, event_id, balance) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance)`,
    [teamId, eventId, amount]
  );
}

// Challenges are open to any registered team. Points are only spent on hints.
router.get('/:id', requireAuth, requireTeam, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const teamId = req.user.teamId;
    const ctx = await loadContext(pool, id, teamId);

    const [hints] = await pool.execute(
      `SELECT h.id, h.body, h.cost, (hp.hint_id IS NOT NULL) AS purchased
       FROM hints h
       LEFT JOIN hint_purchases hp ON hp.hint_id = h.id AND hp.team_id = ?
       WHERE h.challenge_id = ?
       ORDER BY h.id`,
      [teamId, id]
    );
    const [[solved]] = await pool.execute(
      'SELECT 1 AS ok FROM solves WHERE team_id = ? AND challenge_id = ?',
      [teamId, id]
    );

    res.json({
      id,
      title: ctx.title,
      description: ctx.description,
      category: ctx.category,
      point_value: ctx.point_value,
      solved: Boolean(solved),
      hints: hints.map((h) => ({
        id: h.id,
        cost: h.cost,
        purchased: Boolean(h.purchased),
        body: h.purchased ? h.body : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/hints/:hintId/buy', requireAuth, requireTeam, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const hintId = parseId(req.params.hintId);
    const teamId = req.user.teamId;

    const result = await pool.withTransaction(async (conn) => {
      const ctx = await loadContext(conn, id, teamId);
      requireLive(ctx);

      const [[hint]] = await conn.execute(
        'SELECT id, cost FROM hints WHERE id = ? AND challenge_id = ?',
        [hintId, id]
      );
      if (!hint) throw new HttpError(404, 'Hint not found.');

      const [[dup]] = await conn.execute(
        'SELECT 1 AS ok FROM hint_purchases WHERE team_id = ? AND hint_id = ?',
        [teamId, hintId]
      );
      if (dup) throw new HttpError(409, 'Hint already purchased.');

      if (hint.cost > 0) await debit(conn, teamId, ctx.event_id, hint.cost);
      await conn.execute(
        'INSERT INTO hint_purchases (team_id, hint_id) VALUES (?, ?)',
        [teamId, hintId]
      );
      return { purchased: true, cost: hint.cost };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/submit', requireAuth, requireTeam, submitLimiter, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const teamId = req.user.teamId;
    const submitted = typeof req.body.flag === 'string' ? req.body.flag.trim() : '';
    if (!submitted || submitted.length > 256) throw new HttpError(400, 'Invalid submission.');

    const result = await pool.withTransaction(async (conn) => {
      const ctx = await loadContext(conn, id, teamId);
      requireLive(ctx);

      const candidate = Buffer.from(hmacFlag(submitted), 'hex');
      const stored = Buffer.from(ctx.flag_hmac, 'hex');
      const correct = candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
      if (!correct) return { correct: false };

      try {
        // UNIQUE(team_id, challenge_id) makes duplicate solves fail atomically
        await conn.execute(
          'INSERT INTO solves (team_id, challenge_id, event_id, points_awarded) VALUES (?, ?, ?, ?)',
          [teamId, id, ctx.event_id, ctx.point_value]
        );
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'Your team already solved this challenge.');
        throw e;
      }

      await credit(conn, teamId, ctx.event_id, ctx.point_value);
      return { correct: true, points: ctx.point_value };
    });

    if (!result.correct) return res.status(400).json({ error: 'Incorrect flag.' });
    res.json({ message: `Flag accepted. +${result.points} points.`, points: result.points });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
