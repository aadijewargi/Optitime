'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/store');
const { createApp } = require('../src/app');

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-'));
  const store = new Store(path.join(dir, 'db.json'));
  const server = createApp(store).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const headers = { 'Content-Type': 'application/json', 'x-user-id': 'test-user-1234' };
  const call = (p, method = 'GET', body) =>
    fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  try {
    await fn(call, base);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('rejects requests without a user id', async () => {
  await withServer(async (_call, base) => {
    const res = await fetch(`${base}/tasks`);
    assert.strictEqual(res.status, 400);
  });
});

test('task CRUD, validation, and persistence of time spent', async () => {
  await withServer(async (call) => {
    let res = await call('/tasks', 'POST', { title: '', estimateMinutes: 30 });
    assert.strictEqual(res.status, 400);

    res = await call('/tasks', 'POST', { title: 'Math homework', estimateMinutes: 45, priority: 'high' });
    assert.strictEqual(res.status, 201);
    const task = await res.json();

    res = await call('/sessions', 'POST', { minutes: 25, type: 'focus', taskId: task.id });
    assert.strictEqual(res.status, 201);

    const tasks = await (await call('/tasks')).json();
    assert.strictEqual(tasks[0].minutesSpent, 25);

    res = await call(`/tasks/${task.id}`, 'PATCH', { done: true });
    assert.strictEqual((await res.json()).done, true);

    const stats = await (await call('/stats')).json();
    assert.strictEqual(stats.focusToday, 25);
    assert.strictEqual(stats.completedToday, 1);
    assert.ok(stats.streak >= 1);

    res = await call(`/tasks/${task.id}`, 'DELETE');
    assert.strictEqual(res.status, 204);
    res = await call(`/tasks/${task.id}`, 'DELETE');
    assert.strictEqual(res.status, 404);
  });
});

test('schedule endpoint returns blocks for open tasks', async () => {
  await withServer(async (call) => {
    await call('/settings', 'PUT', { dayStart: '00:00', dayEnd: '23:59' });
    await call('/tasks', 'POST', { title: 'Read chapter', estimateMinutes: 30 });
    const schedule = await (await call('/schedule')).json();
    assert.ok(schedule.blocks.some((b) => b.type === 'focus'));
  });
});

test('settings validation', async () => {
  await withServer(async (call) => {
    const res = await call('/settings', 'PUT', { focusMinutes: 500 });
    assert.strictEqual(res.status, 400);
  });
});
