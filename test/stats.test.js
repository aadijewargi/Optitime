'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/store');

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-stats-'));
  return { store: new Store(path.join(dir, 'db.json')), dir };
}

test('stats use the user local day, not the UTC day', () => {
  const { store, dir } = freshStore();
  const uid = 'user-1234567';
  // 7:00 pm in Los Angeles (UTC-7) on Oct 23 is already Oct 24 in UTC.
  const s = store.logSession(uid, { minutes: 25, type: 'focus' });
  store._user(uid).sessions.find((x) => x.id === s.id).endedAt = '2026-10-24T02:00:00.000Z';

  const nowUtc = new Date('2026-10-24T02:30:00.000Z'); // 7:30 pm Oct 23 local
  assert.strictEqual(store.getStats(uid, nowUtc, 420).focusToday, 25); // local: same day
  // 1:00 am Oct 24 local is a new local day, so the session no longer counts.
  assert.strictEqual(store.getStats(uid, new Date('2026-10-24T08:00:00.000Z'), 420).focusToday, 0);
  // Without the offset the old UTC-day behavior is kept (offset defaults to 0).
  assert.strictEqual(store.getStats(uid, nowUtc).focusToday, 25);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('streak counts consecutive local days', () => {
  const { store, dir } = freshStore();
  const uid = 'user-1234567';
  for (const iso of ['2026-10-21T20:00:00.000Z', '2026-10-22T20:00:00.000Z', '2026-10-23T20:00:00.000Z']) {
    const s = store.logSession(uid, { minutes: 25, type: 'focus' });
    store._user(uid).sessions.find((x) => x.id === s.id).endedAt = iso;
  }
  assert.strictEqual(store.getStats(uid, new Date('2026-10-23T22:00:00.000Z'), 420).streak, 3);
  // A day with no session breaks it.
  assert.strictEqual(store.getStats(uid, new Date('2026-10-26T22:00:00.000Z'), 420).streak, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
