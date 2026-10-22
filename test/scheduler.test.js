'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { generateSchedule, sortTasks } = require('../src/scheduler');

const settings = { dayStart: '15:00', dayEnd: '18:00', focusMinutes: 25, breakMinutes: 5 };
// Fixed "now" well before the day window so the plan starts at dayStart.
const now = new Date('2026-10-15T08:00:00');

const mk = (over) => ({
  id: Math.random().toString(36).slice(2),
  title: 'Task',
  estimateMinutes: 25,
  dueDate: null,
  priority: 'medium',
  done: false,
  minutesSpent: 0,
  ...over,
});

test('splits long tasks into focus-sized chunks with breaks between', () => {
  const { blocks } = generateSchedule([mk({ title: 'Essay', estimateMinutes: 60 })], settings, now);
  const focus = blocks.filter((b) => b.type === 'focus');
  assert.deepStrictEqual(focus.map((b) => b.minutes), [25, 25, 10]);
  assert.strictEqual(blocks[1].type, 'break');
  assert.strictEqual(blocks[0].start, '15:00');
});

test('does not end the plan with a break', () => {
  const { blocks } = generateSchedule([mk({ estimateMinutes: 25 })], settings, now);
  assert.strictEqual(blocks[blocks.length - 1].type, 'focus');
});

test('earlier due dates come before later ones', () => {
  const a = mk({ title: 'Later', dueDate: '2026-10-20' });
  const b = mk({ title: 'Sooner', dueDate: '2026-10-16' });
  const sorted = sortTasks([a, b], now);
  assert.strictEqual(sorted[0].title, 'Sooner');
});

test('priority breaks ties when due dates match', () => {
  const lo = mk({ title: 'Low', priority: 'low', dueDate: '2026-10-14' });
  const hi = mk({ title: 'High', priority: 'high', dueDate: '2026-10-14' });
  assert.strictEqual(sortTasks([lo, hi], now)[0].title, 'High');
});

test('leads with a quick win when nothing is urgent', () => {
  const big = mk({ title: 'Big', estimateMinutes: 90 });
  const small = mk({ title: 'Small', estimateMinutes: 10 });
  assert.strictEqual(sortTasks([big, small], now)[0].title, 'Small');
});

test('reports tasks that do not fit in the day window', () => {
  const tasks = [mk({ title: 'Huge', estimateMinutes: 400 })];
  const { blocks, unscheduled } = generateSchedule(tasks, settings, now);
  assert.ok(blocks.length > 0);
  assert.strictEqual(unscheduled.length, 1);
  assert.ok(unscheduled[0].minutesLeft > 0);
});

test('skips completed tasks and accounts for time already spent', () => {
  const done = mk({ title: 'Done', done: true });
  const partial = mk({ title: 'Partial', estimateMinutes: 50, minutesSpent: 25 });
  const { blocks } = generateSchedule([done, partial], settings, now);
  const focus = blocks.filter((b) => b.type === 'focus');
  assert.strictEqual(focus.length, 1);
  assert.strictEqual(focus[0].title, 'Partial');
});

test('never schedules in the past', () => {
  const late = new Date('2026-10-15T16:12:00');
  const { blocks } = generateSchedule([mk()], settings, late);
  assert.strictEqual(blocks[0].start, '16:15');
});
