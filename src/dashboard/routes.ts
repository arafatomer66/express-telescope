import { Router, Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { Telescope } from '../telescope';
import { EntryType, ListQuery } from '../types';

const VALID_TYPES: EntryType[] = [
  'request',
  'exception',
  'query',
  'log',
  'cache',
  'mail',
  'job',
];

export function dashboardRouter(t: Telescope): Router {
  const router = Router();

  // Auth gate
  router.use((req, res, next) => {
    if (t.options.authorize && !t.options.authorize(req)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  });

  // ---- API ----
  router.get('/api/stats', (_req, res) => {
    res.json(t.storage.stats());
  });

  router.get('/api/entries', (req, res) => {
    const q: ListQuery = {};
    const type = String(req.query.type || '');
    if (type && (VALID_TYPES as string[]).includes(type)) q.type = type as EntryType;
    if (req.query.tag) q.tag = String(req.query.tag);
    if (req.query.batchId) q.batchId = String(req.query.batchId);
    if (req.query.familyHash) q.familyHash = String(req.query.familyHash);
    if (req.query.before) q.before = String(req.query.before);
    if (req.query.limit) q.limit = parseInt(String(req.query.limit), 10) || 50;

    res.json({ entries: t.storage.list(q) });
  });

  router.get('/api/entries/:id', (req, res) => {
    const entry = t.storage.get(req.params.id);
    if (!entry) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const batch = entry.batchId ? t.storage.getBatch(entry.batchId) : [];
    res.json({ entry, batch });
  });

  router.delete('/api/entries', (req, res) => {
    const type = req.query.type ? String(req.query.type) : undefined;
    if (type && !(VALID_TYPES as string[]).includes(type)) {
      res.status(400).json({ error: 'Invalid type' });
      return;
    }
    const deleted = t.storage.clear(type as EntryType | undefined);
    res.json({ deleted });
  });

  // ---- UI ----
  const publicDir = path.join(__dirname, 'public');
  router.get('/', (_req, res, next) => sendFile(publicDir, 'index.html', res, next));
  router.get('/app.js', (_req, res, next) => sendFile(publicDir, 'app.js', res, next));
  router.get('/styles.css', (_req, res, next) => sendFile(publicDir, 'styles.css', res, next));

  return router;
}

function sendFile(dir: string, name: string, res: Response, next: NextFunction) {
  const file = path.join(dir, name);
  fs.readFile(file, (err, data) => {
    if (err) return next(err);
    const ct = name.endsWith('.html')
      ? 'text/html; charset=utf-8'
      : name.endsWith('.js')
        ? 'application/javascript; charset=utf-8'
        : 'text/css; charset=utf-8';
    res.setHeader('Content-Type', ct);
    res.send(data);
  });
}
