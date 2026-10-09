const router = require('express').Router();
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const multer = require('multer');
const pool = require('../db');
const { requireAuth, requireTeam } = require('../middleware');
const {
  HttpError,
  TEAM_NAME_RE,
  MAX_TEAM_SIZE,
  EVENT_STATUS_SQL,
  parseId,
  toStr,
} = require('../lib/util');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

// Magic-byte sniffing. Extension and client MIME type are ignored. SVG is rejected on purpose.
const SIGNATURES = [
  { ext: 'png', ok: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) },
  { ext: 'jpg', ok: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', ok: (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('ascii')) },
  {
    ext: 'webp',
    ok: (b) => b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];
const sniffImage = (buf) => SIGNATURES.find((s) => s.ok(buf))?.ext ?? null;

async function requireCaptain(teamId, userId) {
  const [[team]] = await pool.execute('SELECT id, name, captain_id FROM teams WHERE id = ?', [teamId]);
  if (!team) throw new HttpError(404, 'Team not found.');
  if (team.captain_id !== userId) throw new HttpError(403, 'Only the team captain can do this.');
  return team;
}

// Roster is frozen while the team is competing in a live event
async function isTeamLive(teamId) {
  const [[row]] = await pool.execute(
    `SELECT 1 AS live FROM event_registrations er
     JOIN events e ON e.id = er.event_id
     WHERE er.team_id = ? AND ${EVENT_STATUS_SQL} = 'live' LIMIT 1`,
    [teamId]
  );
  return Boolean(row);
}

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT t.id, t.name, t.profile_photo, u.username AS captain,
              (SELECT COUNT(*) FROM users m WHERE m.team_id = t.id) AS member_count,
              (SELECT COUNT(*) FROM solves s WHERE s.team_id = t.id) AS flag_count,
              (SELECT CAST(COALESCE(SUM(s.points_awarded), 0) AS UNSIGNED) FROM solves s WHERE s.team_id = t.id) AS total_points
       FROM teams t
       JOIN users u ON u.id = t.captain_id
       ORDER BY total_points DESC, t.name ASC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const [[team]] = await pool.execute(
      `SELECT t.id, t.name, t.profile_photo, t.captain_id, u.username AS captain
       FROM teams t JOIN users u ON u.id = t.captain_id
       WHERE t.id = ?`,
      [id]
    );
    if (!team) throw new HttpError(404, 'Team not found.');

    const [members] = await pool.execute(
      'SELECT id, username FROM users WHERE team_id = ? ORDER BY id',
      [id]
    );
    const [events] = await pool.execute(
      `SELECT e.id, e.name, ${EVENT_STATUS_SQL} AS status
       FROM event_registrations er JOIN events e ON e.id = er.event_id
       WHERE er.team_id = ? ORDER BY e.start_time DESC`,
      [id]
    );
    const [[stats]] = await pool.execute(
      `SELECT COUNT(*) AS flag_count,
              CAST(COALESCE(SUM(points_awarded), 0) AS UNSIGNED) AS total_points
       FROM solves WHERE team_id = ?`,
      [id]
    );

    res.json({
      id: team.id,
      name: team.name,
      profile_photo: team.profile_photo,
      captain: team.captain,
      flag_count: stats.flag_count,
      total_points: stats.total_points,
      members: members.map((m) => ({
        id: m.id,
        username: m.username,
        role: m.id === team.captain_id ? 'Captain' : 'Member',
      })),
      events,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const name = toStr(req.body.name, 3, 40, 'Team name');
    if (!TEAM_NAME_RE.test(name)) {
      throw new HttpError(400, 'Team name may contain letters, numbers, spaces, . _ - only.');
    }
    if (req.user.teamId) throw new HttpError(409, 'Leave your current team first.');

    const teamId = await pool.withTransaction(async (conn) => {
      const [r] = await conn.execute(
        'INSERT INTO teams (name, captain_id) VALUES (?, ?)',
        [name, req.user.id]
      );
      const [u] = await conn.execute(
        'UPDATE users SET team_id = ? WHERE id = ? AND team_id IS NULL',
        [r.insertId, req.user.id]
      );
      if (u.affectedRows !== 1) throw new HttpError(409, 'You are already in a team.');
      return r.insertId;
    });

    res.status(201).json({ id: teamId, name });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return next(new HttpError(409, 'Team name already taken.'));
    next(err);
  }
});

router.put('/:id/photo', requireAuth, upload.single('photo'), async (req, res, next) => {
  try {
    const teamId = parseId(req.params.id);
    const team = await requireCaptain(teamId, req.user.id);
    if (!req.file) throw new HttpError(400, 'No file uploaded.');

    const ext = sniffImage(req.file.buffer);
    if (!ext) throw new HttpError(400, 'Unsupported image. Use PNG, JPEG, GIF, or WebP.');

    const filename = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(path.join(UPLOAD_DIR, filename), req.file.buffer, { flag: 'wx' });

    // Read the old filename before the update so it can be removed afterwards
    const [[before]] = await pool.execute('SELECT profile_photo FROM teams WHERE id = ?', [team.id]);
    await pool.execute('UPDATE teams SET profile_photo = ? WHERE id = ?', [filename, team.id]);

    if (before?.profile_photo) {
      await fs.unlink(path.join(UPLOAD_DIR, path.basename(before.profile_photo))).catch(() => {});
    }
    res.json({ profile_photo: filename });
  } catch (err) {
    next(err);
  }
});

// Captain-only: pending join requests sent by players
router.get('/:id/requests', requireAuth, async (req, res, next) => {
  try {
    const teamId = parseId(req.params.id);
    await requireCaptain(teamId, req.user.id);

    const [rows] = await pool.execute(
      `SELECT r.id, u.username, r.created_at
       FROM team_requests r JOIN users u ON u.id = r.user_id
       WHERE r.team_id = ? AND r.type = 'request' AND r.status = 'pending'
       ORDER BY r.created_at`,
      [teamId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/invites', requireAuth, async (req, res, next) => {
  try {
    const teamId = parseId(req.params.id);
    await requireCaptain(teamId, req.user.id);

    const username = toStr(req.body.username, 3, 32, 'Username');
    const [[target]] = await pool.execute('SELECT id, team_id FROM users WHERE username = ?', [username]);
    if (!target) throw new HttpError(404, 'User not found.');
    if (target.team_id) throw new HttpError(409, 'User is already in a team.');

    const [[dup]] = await pool.execute(
      "SELECT id FROM team_requests WHERE team_id = ? AND user_id = ? AND status = 'pending'",
      [teamId, target.id]
    );
    if (dup) throw new HttpError(409, 'Invitation already pending.');

    await pool.execute(
      "INSERT INTO team_requests (team_id, user_id, type) VALUES (?, ?, 'invite')",
      [teamId, target.id]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/requests', requireAuth, async (req, res, next) => {
  try {
    if (req.user.teamId) throw new HttpError(409, 'Leave your current team first.');
    const teamId = parseId(req.params.id);

    const [[team]] = await pool.execute('SELECT id FROM teams WHERE id = ?', [teamId]);
    if (!team) throw new HttpError(404, 'Team not found.');

    const [[dup]] = await pool.execute(
      "SELECT id FROM team_requests WHERE team_id = ? AND user_id = ? AND status = 'pending'",
      [teamId, req.user.id]
    );
    if (dup) throw new HttpError(409, 'Request already pending.');

    await pool.execute(
      "INSERT INTO team_requests (team_id, user_id, type) VALUES (?, ?, 'request')",
      [teamId, req.user.id]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Accept or decline. Invites are answered by the invitee; join requests by the captain.
router.patch('/requests/:rid', requireAuth, async (req, res, next) => {
  try {
    const rid = parseId(req.params.rid);
    const action = req.body.action;
    if (action !== 'accept' && action !== 'decline') {
      throw new HttpError(400, 'Action must be accept or decline.');
    }

    await pool.withTransaction(async (conn) => {
      const [[r]] = await conn.execute(
        'SELECT id, team_id, user_id, type, status FROM team_requests WHERE id = ? FOR UPDATE',
        [rid]
      );
      if (!r) throw new HttpError(404, 'Request not found.');
      if (r.status !== 'pending') throw new HttpError(409, 'Request already resolved.');

      if (r.type === 'invite') {
        if (r.user_id !== req.user.id) throw new HttpError(403, 'This invitation is not yours.');
      } else {
        const [[t]] = await conn.execute('SELECT captain_id FROM teams WHERE id = ?', [r.team_id]);
        if (!t || t.captain_id !== req.user.id) {
          throw new HttpError(403, 'Only the captain can respond to join requests.');
        }
      }

      if (action === 'decline') {
        await conn.execute("UPDATE team_requests SET status = 'declined' WHERE id = ?", [rid]);
        return;
      }

      const [[target]] = await conn.execute('SELECT team_id FROM users WHERE id = ? FOR UPDATE', [r.user_id]);
      if (target.team_id) throw new HttpError(409, 'That user has already joined a team.');

      const [[size]] = await conn.execute('SELECT COUNT(*) AS n FROM users WHERE team_id = ?', [r.team_id]);
      if (size.n >= MAX_TEAM_SIZE) throw new HttpError(409, 'Team is full.');

      await conn.execute('UPDATE users SET team_id = ? WHERE id = ?', [r.team_id, r.user_id]);
      await conn.execute("UPDATE team_requests SET status = 'accepted' WHERE id = ?", [rid]);
      // A user can only belong to one team, so their other open requests and invites lapse
      await conn.execute(
        "UPDATE team_requests SET status = 'declined' WHERE user_id = ? AND status = 'pending' AND id <> ?",
        [r.user_id, rid]
      );
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/leave', requireAuth, requireTeam, async (req, res, next) => {
  try {
    const teamId = req.user.teamId;
    const [[team]] = await pool.execute('SELECT captain_id FROM teams WHERE id = ?', [teamId]);
    if (team.captain_id === req.user.id) throw new HttpError(409, 'Transfer captaincy before leaving.');
    if (await isTeamLive(teamId)) throw new HttpError(409, 'Roster is locked during a live event.');

    await pool.execute('UPDATE users SET team_id = NULL WHERE id = ?', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/transfer', requireAuth, async (req, res, next) => {
  try {
    const teamId = parseId(req.params.id);
    const targetId = parseId(req.body.userId);
    await requireCaptain(teamId, req.user.id);

    const [[member]] = await pool.execute('SELECT id FROM users WHERE id = ? AND team_id = ?', [targetId, teamId]);
    if (!member) throw new HttpError(404, 'New captain must be a team member.');

    await pool.execute('UPDATE teams SET captain_id = ? WHERE id = ?', [targetId, teamId]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/members/:userId/remove', requireAuth, async (req, res, next) => {
  try {
    const teamId = parseId(req.params.id);
    const targetId = parseId(req.params.userId);
    await requireCaptain(teamId, req.user.id);

    if (targetId === req.user.id) {
      throw new HttpError(400, 'Captains cannot remove themselves. Transfer captaincy first.');
    }
    if (await isTeamLive(teamId)) throw new HttpError(409, 'Roster is locked during a live event.');

    const [r] = await pool.execute(
      'UPDATE users SET team_id = NULL WHERE id = ? AND team_id = ?',
      [targetId, teamId]
    );
    if (r.affectedRows !== 1) throw new HttpError(404, 'Member not found in this team.');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
