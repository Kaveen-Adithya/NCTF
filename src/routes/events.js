const router = require('express').Router();
const pool = require('../db');
const { requireAuth, requireTeam } = require('../middleware');
const { HttpError, parseId, EVENT_STATUS_SQL } = require('../lib/util');

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT e.id, e.name, e.description, e.start_time, e.end_time,
              ${EVENT_STATUS_SQL} AS status,
              (SELECT COUNT(*) FROM event_registrations er WHERE er.event_id = e.id) AS team_count,
              (SELECT COUNT(*) FROM challenges c WHERE c.event_id = e.id) AS challenge_count
       FROM events e
       ORDER BY e.start_time DESC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const [[event]] = await pool.execute(
      `SELECT e.id, e.name, e.description, e.start_time, e.end_time, ${EVENT_STATUS_SQL} AS status
       FROM events e WHERE e.id = ?`,
      [id]
    );
    if (!event) throw new HttpError(404, 'Event not found.');
    res.json(event);
  } catch (err) {
    next(err);
  }
});

// Team-scoped challenge list. All challenges are open to registered teams; points are spent only on hints.
router.get('/:id/challenges', requireAuth, requireTeam, async (req, res, next) => {
  try {
    const eventId = parseId(req.params.id);
    const teamId = req.user.teamId;

    const [[reg]] = await pool.execute(
      'SELECT 1 AS ok FROM event_registrations WHERE event_id = ? AND team_id = ?',
      [eventId, teamId]
    );
    if (!reg) throw new HttpError(403, 'Your team is not registered for this event.');

    const [rows] = await pool.execute(
      `SELECT c.id, c.title, c.category, c.point_value,
              (s.team_id IS NOT NULL) AS solved
       FROM challenges c
       LEFT JOIN solves s ON s.challenge_id = c.id AND s.team_id = ?
       WHERE c.event_id = ?
       ORDER BY c.point_value, c.id`,
      [teamId, eventId]
    );

    const [[bal]] = await pool.execute(
      'SELECT balance FROM team_event_balances WHERE team_id = ? AND event_id = ?',
      [teamId, eventId]
    );

    const challenges = rows.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      point_value: r.point_value,
      solved: Boolean(r.solved),
    }));

    res.json({ balance: bal ? bal.balance : 0, challenges });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/register', requireAuth, requireTeam, async (req, res, next) => {
  try {
    const eventId = parseId(req.params.id);
    const teamId = req.user.teamId;

    const [[team]] = await pool.execute('SELECT captain_id FROM teams WHERE id = ?', [teamId]);
    if (team.captain_id !== req.user.id) {
      throw new HttpError(403, 'Only the team captain can register the team.');
    }

    await pool.withTransaction(async (conn) => {
      const [[event]] = await conn.execute(
        `SELECT e.id, ${EVENT_STATUS_SQL} AS status FROM events e WHERE e.id = ?`,
        [eventId]
      );
      if (!event) throw new HttpError(404, 'Event not found.');
      if (event.status === 'ended') throw new HttpError(409, 'This event has ended.');

      await conn.execute(
        'INSERT INTO event_registrations (event_id, team_id) VALUES (?, ?)',
        [eventId, teamId]
      );
      await conn.execute(
        'INSERT INTO team_event_balances (team_id, event_id, balance) VALUES (?, ?, 0)',
        [teamId, eventId]
      );
    });

    res.status(201).json({ registered: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return next(new HttpError(409, 'Team is already registered.'));
    next(err);
  }
});

// Public. Team names only; no member identities.
router.get('/:id/scoreboard', async (req, res, next) => {
  try {
    const eventId = parseId(req.params.id);
    const [rows] = await pool.execute(
      `SELECT t.id AS team_id, t.name,
              CAST(COALESCE(SUM(s.points_awarded), 0) AS UNSIGNED) AS score,
              COUNT(s.challenge_id) AS solves,
              COALESCE(MAX(s.solved_at), '9999-12-31 00:00:00') AS last_solve
       FROM event_registrations er
       JOIN teams t ON t.id = er.team_id
       LEFT JOIN solves s ON s.team_id = er.team_id AND s.event_id = er.event_id
       WHERE er.event_id = ?
       GROUP BY t.id, t.name
       ORDER BY score DESC, last_solve ASC`,
      [eventId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
