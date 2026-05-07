import express from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import {
  installTelescope,
  attachErrorHandler,
  patchBetterSqlite,
  trackQuery,
} from '../src';

const app = express();
app.use(express.json());

// Install Telescope before your routes
const t = installTelescope(app, {
  path: '/telescope',
  storagePath: path.join(__dirname, '.telescope.sqlite'),
  slowQueryThreshold: 50,
});

// Demo DB so the query watcher has something to record
const demoDb = new Database(':memory:');
patchBetterSqlite(t, demoDb as never, 'demo');
demoDb.exec(`
  CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
  INSERT INTO users (name, email) VALUES ('Alice','alice@example.com'),('Bob','bob@example.com');
`);

// ---- Routes ----
app.get('/', (_req, res) => {
  res.json({
    message: 'Hello from express-telescope demo',
    dashboard: '/telescope',
    try: ['/users', '/users/1', '/slow', '/boom', '/log'],
  });
});

app.get('/users', (_req, res) => {
  const rows = demoDb.prepare('SELECT * FROM users').all();
  res.json(rows);
});

app.get('/users/:id', (req, res) => {
  const row = demoDb.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

app.get('/slow', async (_req, res) => {
  await trackQuery(t, 'demo', 'SELECT pg_sleep(0.2)', [], async () => {
    await new Promise((r) => setTimeout(r, 200));
  });
  res.json({ ok: true });
});

app.get('/log', (_req, res) => {
  console.log('something interesting just happened', { user: 1 });
  console.warn('this is a warning');
  res.json({ logged: true });
});

app.get('/boom', () => {
  throw new Error('Demo exception from /boom');
});

app.post('/echo', (req, res) => {
  res.json({ received: req.body });
});

// IMPORTANT: error handler AFTER routes
attachErrorHandler(t, app);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`\n  Demo server: http://localhost:${port}`);
  console.log(`  Telescope:   http://localhost:${port}/telescope\n`);
});
