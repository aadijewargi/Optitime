'use strict';

const express = require('express');
const path = require('path');
const { generateSchedule } = require('./scheduler');
const { validateTask, validateSettings, validateSession } = require('./validate');

/**
 * Builds the Express app. The store is injected so tests can use a temp file.
 *
 * Identity: for this MVP there are no accounts. The browser generates an
 * anonymous id and sends it in the `x-user-id` header. Swap this middleware
 * for real auth (sessions/JWT) when you add accounts.
 */
function createApp(store) {
  const app = express();
  app.use(express.json({ limit: '50kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/api', (req, res, next) => {
    const id = req.get('x-user-id');
    if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
      return res.status(400).json({ error: 'Missing or invalid x-user-id header' });
    }
    req.userId = id;
    res.set('Cache-Control', 'no-store'); // live data: never serve a stale copy
    next();
  });

  // ---- Tasks ----
  app.get('/api/tasks', (req, res) => {
    res.json(store.listTasks(req.userId));
  });

  app.post('/api/tasks', (req, res) => {
    const { errors, value } = validateTask(req.body || {});
    if (errors.length) return res.status(400).json({ errors });
    res.status(201).json(store.addTask(req.userId, value));
  });

  app.patch('/api/tasks/:id', (req, res) => {
    const { errors, value } = validateTask(req.body || {}, { partial: true });
    if (errors.length) return res.status(400).json({ errors });
    const task = store.updateTask(req.userId, req.params.id, value);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  });

  app.delete('/api/tasks/:id', (req, res) => {
    if (!store.deleteTask(req.userId, req.params.id)) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.status(204).end();
  });

  // ---- Schedule ----
  // The browser sends its own local clock (?now=2026-10-23T15:32:00) so the plan
  // starts at the user's current time even if the server runs in another timezone.
  app.get('/api/schedule', (req, res) => {
    const clientNow = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(req.query.now || '')
      ? new Date(req.query.now)
      : null;
    const now = clientNow && !Number.isNaN(clientNow.getTime()) ? clientNow : new Date();
    res.json(generateSchedule(store.listTasks(req.userId), store.getSettings(req.userId), now));
  });

  // ---- Settings ----
  app.get('/api/settings', (req, res) => {
    res.json(store.getSettings(req.userId));
  });

  app.put('/api/settings', (req, res) => {
    const { errors, value } = validateSettings(req.body || {});
    if (errors.length) return res.status(400).json({ errors });
    res.json(store.updateSettings(req.userId, value));
  });

  // ---- Timer sessions & stats ----
  app.post('/api/sessions', (req, res) => {
    const { errors, value } = validateSession(req.body || {});
    if (errors.length) return res.status(400).json({ errors });
    res.status(201).json(store.logSession(req.userId, value));
  });

  // ?tzOffset is the browser's Date#getTimezoneOffset() so "today" means the
  // user's local day, not the UTC day.
  app.get('/api/stats', (req, res) => {
    const offset = Number(req.query.tzOffset);
    const tzOffset = Number.isInteger(offset) && Math.abs(offset) <= 840 ? offset : 0;
    res.json(store.getStats(req.userId, new Date(), tzOffset));
  });

  // ---- Fallbacks ----
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}

module.exports = { createApp };
