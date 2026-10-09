const crypto = require('crypto');
const jwt = require('jsonwebtoken');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

const COOKIE_NAME = 'nctf_token';
const EMAIL_RE = /^[a-z0-9._%+-]+@gmail\.com$/;
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const TEAM_NAME_RE = /^[A-Za-z0-9 ._-]{3,40}$/;
const MAX_TEAM_SIZE = Number(process.env.MAX_TEAM_SIZE) || 8;

// Derived from the clock on the database side, so the status never drifts.
const EVENT_STATUS_SQL = `CASE
  WHEN UTC_TIMESTAMP() < e.start_time THEN 'upcoming'
  WHEN UTC_TIMESTAMP() < e.end_time THEN 'live'
  ELSE 'ended' END`;

function issueToken(res, userId) {
  const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '2h',
  });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 2 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearToken(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

const hmacFlag = (flag) =>
  crypto.createHmac('sha256', process.env.FLAG_PEPPER).update(flag, 'utf8').digest('hex');

function parseId(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(404, 'Not found.');
  return n;
}

function toInt(value, min, max, field) {
  const n = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${field} must be an integer between ${min} and ${max}.`);
  }
  return n;
}

function toStr(value, min, max, field) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (s.length < min || s.length > max) {
    throw new HttpError(400, `${field} must be ${min}-${max} characters.`);
  }
  return s;
}

function toDate(value, field) {
  const d = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(d.getTime())) {
    throw new HttpError(400, `${field} must be a valid date.`);
  }
  return d;
}

module.exports = {
  HttpError,
  COOKIE_NAME,
  EMAIL_RE,
  USERNAME_RE,
  TEAM_NAME_RE,
  MAX_TEAM_SIZE,
  EVENT_STATUS_SQL,
  issueToken,
  clearToken,
  hmacFlag,
  parseId,
  toInt,
  toStr,
  toDate,
};
