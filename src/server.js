require('dotenv').config();

const required = ['JWT_SECRET', 'FLAG_PEPPER', 'DB_USER'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32 || process.env.FLAG_PEPPER.length < 32) {
  console.error('JWT_SECRET and FLAG_PEPPER must be at least 32 characters.');
  process.exit(1);
}

const app = require('./app');
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`NCTF listening on http://localhost:${port}`));
