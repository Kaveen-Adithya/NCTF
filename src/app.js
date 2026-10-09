const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  req.body ??= {};
  next();
});
app.use(cookieParser());

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), { dotfiles: 'deny' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/events', require('./routes/events'));
app.use('/api/challenges', require('./routes/challenges'));
app.use('/api/teams', require('./routes/teams'));
app.use('/api/admin', require('./routes/admin'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Central error handler: never leak stack traces or SQL details to clients
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 2 MB).' });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Already exists.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large.' });

  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
  res.status(status).json({ error: err.message || 'Request failed.' });
});

module.exports = app;
