const router = require('express').Router();
const pool = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');
const {
  HttpError,
  hmacFlag,
  parseId,
  toInt,
  toStr,
  toDate,
  EVENT_STATUS_SQL,
} = require('../lib/util');

router.use(requireAuth, requireAdmin);

function readEventBody(body) {
  const name = toStr(body.name, 1, 120, 'Event name');
  const description = typeof body.description === 'string' ? body.description.slice(0, 5000) : null;
  const start = toDate(body.start_time, 'Start time');
  const end = toDate(body.end_time, 'End time');
  if (end <= start) throw new HttpError(400, 'End time must be after start time.');
  return { name, description, start, end };
}

async function requireEvent(id) {
  const [[ev]] = await pool.execute('SELECT id FROM events WHERE id = ?', [id]);
  if (!ev) throw new HttpError(404, 'Event not found.');
}

// ---------- events ----------

router.get('/events', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT e.id, e.name, e.description, e.start_time, e.end_time, ${EVENT_STATUS_SQL} AS status,
              (SELECT COUNT(*) FROM challenges c WHERE c.event_id = e.id) AS challenge_count,
              (SELECT COUNT(*) FROM event_registrations er WHERE er.event_id = e.id) AS team_count
       FROM events e ORDER BY e.start_time DESC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/events', async (req, res, next) => {
  try {
    const ev = readEventBody(req.body);
    const [r] = await pool.execute(
      'INSERT INTO events (name, description, start_time, end_time) VALUES (?, ?, ?, ?)',
      [ev.name, ev.description, ev.start, ev.end]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) {
    next(err);
  }
});

router.patch('/events/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    await requireEvent(id);
    const ev = readEventBody(req.body);
    await pool.execute(
      'UPDATE events SET name = ?, description = ?, start_time = ?, end_time = ? WHERE id = ?',
      [ev.name, ev.description, ev.start, ev.end, id]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Deleting an event cascades to its challenges, hints, registrations, and solves
router.delete('/events/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    await requireEvent(id);
    await pool.execute('DELETE FROM events WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- challenges ----------

router.get('/events/:id/challenges', async (req, res, next) => {
  try {
    const eventId = parseId(req.params.id);
    const [rows] = await pool.execute(
      `SELECT c.id, c.title, c.category, c.point_value,
              (SELECT COUNT(*) FROM hints h WHERE h.challenge_id = c.id) AS hint_count,
              (SELECT COUNT(*) FROM solves s WHERE s.challenge_id = c.id) AS solves
       FROM challenges c WHERE c.event_id = ? ORDER BY c.id`,
      [eventId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/events/:id/challenges', async (req, res, next) => {
  try {
    const eventId = parseId(req.params.id);
    const title = toStr(req.body.title, 1, 120, 'Title');
    const description = typeof req.body.description === 'string' ? req.body.description.slice(0, 10000) : '';
    const category = toStr(req.body.category || 'misc', 1, 40, 'Category');
    const flag = toStr(req.body.flag, 1, 256, 'Flag');
    const points = toInt(req.body.point_value, 1, 100000, 'Point value');

    const hints = Array.isArray(req.body.hints) ? req.body.hints : [];
    if (hints.length > 10) throw new HttpError(400, 'Maximum 10 hints per challenge.');
    const cleanHints = hints.map((h) => ({
      body: toStr(h?.body, 1, 2000, 'Hint'),
      cost: toInt(h?.cost ?? 0, 0, 100000, 'Hint cost'),
    }));

    const id = await pool.withTransaction(async (conn) => {
      const [r] = await conn.execute(
        `INSERT INTO challenges (event_id, title, description, category, flag_hmac, point_value)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [eventId, title, description, category, hmacFlag(flag), points]
      );
      for (const h of cleanHints) {
        await conn.execute(
          'INSERT INTO hints (challenge_id, body, cost) VALUES (?, ?, ?)',
          [r.insertId, h.body, h.cost]
        );
      }
      return r.insertId;
    });

    res.status(201).json({ id });
  } catch (err) {
    if (err.code === 'ER_NO_REFERENCED_ROW_2') return next(new HttpError(404, 'Event not found.'));
    next(err);
  }
});

router.delete('/challenges/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const [r] = await pool.execute('DELETE FROM challenges WHERE id = ?', [id]);
    if (r.affectedRows !== 1) throw new HttpError(404, 'Challenge not found.');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- teams ----------

router.get('/teams', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT t.id, t.name, u.username AS captain,
              (SELECT COUNT(*) FROM users m WHERE m.team_id = t.id) AS member_count,
              (SELECT COUNT(*) FROM solves s WHERE s.team_id = t.id) AS flag_count,
              (SELECT CAST(COALESCE(SUM(s.points_awarded), 0) AS UNSIGNED) FROM solves s WHERE s.team_id = t.id) AS total_points
       FROM teams t JOIN users u ON u.id = t.captain_id
       ORDER BY t.name`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Removes the team, detaches its members (users.team_id is SET NULL), and drops its solves
router.delete('/teams/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const [r] = await pool.execute('DELETE FROM teams WHERE id = ?', [id]);
    if (r.affectedRows !== 1) throw new HttpError(404, 'Team not found.');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
