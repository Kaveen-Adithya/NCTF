require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('./db');

const ADMIN_EMAIL = 'admin@gmail.com';

(async () => {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 12) {
    console.error('Set ADMIN_PASSWORD (12+ characters) in .env before seeding.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  const [[existing]] = await pool.execute('SELECT id FROM users WHERE email = ?', [ADMIN_EMAIL]);

  if (existing) {
    await pool.execute('UPDATE users SET password_hash = ?, role = ? WHERE id = ?', [hash, 'admin', existing.id]);
    console.log('Admin account updated from ADMIN_PASSWORD.');
  } else {
    await pool.execute(
      'INSERT INTO users (email, username, password_hash, role) VALUES (?, ?, ?, ?)',
      [ADMIN_EMAIL, 'admin', hash, 'admin']
    );
    console.log('Admin account created.');
  }
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
