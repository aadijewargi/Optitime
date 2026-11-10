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

// ---------------------------------------------------------------------------
// Optimizer-backed planning
// ---------------------------------------------------------------------------
const { daySlots, toMinutes } = require('../src/scheduler');

const focusMinutes = (blocks) =>
  blocks.filter((b) => b.type === 'focus').reduce((s, b) => s + b.minutes, 0);

test('day slots: inside the window, no overlaps, long break after every 4th block', () => {
  const slots = daySlots(toMinutes('15:00'), toMinutes('21:00'), 25, 5, 15);
  let prevEnd = toMinutes('15:00');
  let focusCount = 0;
  for (const s of slots) {
    assert.ok(s.start >= prevEnd && s.end <= toMinutes('21:00') && s.end > s.start);
    prevEnd = s.end;
    if (s.type === 'focus') focusCount += 1;
    else assert.strictEqual(s.end - s.start, focusCount % 4 === 0 ? 15 : 5);
  }
  assert.strictEqual(slots[0].type, 'focus');
});

test('when the day is overloaded it sacrifices low priority work, not high', () => {
  // 15:00-16:00 with 25/5 -> 50 focus minutes today, 80 minutes of work.
  const s = { dayStart: '15:00', dayEnd: '16:00', focusMinutes: 25, breakMinutes: 5 };
  const tasks = [
    mk({ id: 'essay', title: 'Essay', estimateMinutes: 30, priority: 'low', dueDate: '2026-10-15' }),
    mk({ id: 'quiz', title: 'Quiz prep', estimateMinutes: 25, priority: 'high', dueDate: '2026-10-15' }),
    mk({ id: 'lab', title: 'Lab report', estimateMinutes: 25, priority: 'high', dueDate: '2026-10-15' }),
  ];
  const { plan, summary, unscheduled } = generateSchedule(tasks, s, now);
  const late = plan.filter((p) => p.late).map((p) => p.taskId);
  assert.deepStrictEqual(late, ['essay']);
  assert.strictEqual(unscheduled[0].taskId, 'essay');
  // The old rule order (due date, priority, size) is no better.
  assert.ok(summary.weightedLateMinutes <= summary.baseline.weightedLateMinutes);
  assert.strictEqual(summary.method, 'exact');
});

test('beats the old rule order when a big due-today task blocks important work', () => {
  // Today: 50 focus minutes. Tomorrow: a full 15:00-18:00 window.
  const s = { dayStart: '15:00', dayEnd: '16:00', focusMinutes: 25, breakMinutes: 5 };
  const tasks = [
    mk({ id: 'big', estimateMinutes: 120, priority: 'low', dueDate: '2026-10-15' }),
    mk({ id: 'a', estimateMinutes: 25, priority: 'high', dueDate: '2026-10-16' }),
    mk({ id: 'b', estimateMinutes: 25, priority: 'high', dueDate: '2026-10-16' }),
  ];
  const { summary, plan } = generateSchedule(tasks, s, now);
  // Old order: big first (earliest due) -> both high-priority tasks late too.
  assert.strictEqual(summary.baseline.lateTasks, 3);
  assert.strictEqual(summary.lateTasks, 1);
  assert.ok(summary.weightedLateMinutes < summary.baseline.weightedLateMinutes);
  assert.strictEqual(plan[plan.length - 1].taskId, 'big');
});

test('a task due later is not late just because it does not fit today', () => {
  // 145 focus minutes fit in 15:00-18:00, so 200 minutes finish tomorrow.
  const tasks = [mk({ id: 'proj', estimateMinutes: 200, dueDate: '2026-10-17' })];
  const { plan, unscheduled } = generateSchedule(tasks, settings, now);
  assert.strictEqual(plan[0].late, false);
  assert.strictEqual(plan[0].finishesOn, 'tomorrow');
  assert.strictEqual(unscheduled[0].reason, 'Partly scheduled - day window is full');
});

test('overdue work goes first and says why', () => {
  const tasks = [
    mk({ id: 'new', estimateMinutes: 25, priority: 'high', dueDate: '2026-10-20' }),
    mk({ id: 'old', estimateMinutes: 25, priority: 'low', dueDate: '2026-10-13' }),
  ];
  const { blocks, plan } = generateSchedule(tasks, settings, now, { quickWin: false });
  assert.strictEqual(blocks[0].taskId, 'old');
  assert.match(plan[0].reason, /^Overdue since/);
});

test('quick win leads only when it makes nothing late', () => {
  // The optimizer alone would start the task due today; a 10-min warm-up still fits.
  const free = [mk({ id: 'big', estimateMinutes: 90, dueDate: '2026-10-15' }), mk({ id: 'tiny', estimateMinutes: 10 })];
  assert.strictEqual(generateSchedule(free, settings, now, { quickWin: false }).blocks[0].taskId, 'big');
  const r1 = generateSchedule(free, settings, now);
  assert.strictEqual(r1.blocks[0].taskId, 'tiny');
  assert.strictEqual(r1.plan[0].reason, 'Quick win to build momentum');

  // Already first on its own merits: keep the real reason.
  const dueSmall = [mk({ id: 'small', estimateMinutes: 10, dueDate: '2026-10-15' }), mk({ id: 'big', estimateMinutes: 90 })];
  assert.strictEqual(generateSchedule(dueSmall, settings, now).plan[0].reason, 'Due today');

  // 15:00-15:30 window: only 25 minutes. The due-today task needs all of it.
  const tight = { ...settings, dayEnd: '15:30' };
  const busy = [
    mk({ id: 'due', estimateMinutes: 25, priority: 'high', dueDate: '2026-10-15' }),
    mk({ id: 'tiny', estimateMinutes: 10, priority: 'low' }),
  ];
  const r2 = generateSchedule(busy, tight, now);
  assert.strictEqual(r2.blocks[0].taskId, 'due');
  assert.strictEqual(r2.summary.lateTasks, 0);
});

test('fills a focus block with the next task instead of wasting it', () => {
  const tasks = [
    mk({ id: 'a', estimateMinutes: 15, dueDate: '2026-10-15' }),
    mk({ id: 'b', estimateMinutes: 20, dueDate: '2026-10-16' }),
  ];
  const { blocks } = generateSchedule(tasks, settings, now, { quickWin: false });
  assert.deepStrictEqual(
    blocks.map((b) => [b.type, b.taskId, b.start, b.end]),
    [
      ['focus', 'a', '15:00', '15:15'],
      ['focus', 'b', '15:15', '15:25'],
      ['break', null, '15:25', '15:30'],
      ['focus', 'b', '15:30', '15:40'],
    ],
  );
  assert.strictEqual(blocks[1].part, '1/2');
});

test('many tasks switch to the heuristic and still produce a valid plan', () => {
  const tasks = Array.from({ length: 25 }, (_, i) =>
    mk({ id: `t${i}`, estimateMinutes: 5 + ((i * 17) % 60), dueDate: `2026-10-${15 + (i % 5)}`, priority: ['low', 'medium', 'high'][i % 3] }),
  );
  const { summary, plan } = generateSchedule(tasks, settings, now);
  assert.strictEqual(summary.method, 'heuristic');
  assert.strictEqual(new Set(plan.map((p) => p.taskId)).size, 25);
});

test('an empty or inverted day window plans nothing and does not crash', () => {
  const inverted = { ...settings, dayStart: '18:00', dayEnd: '15:00' };
  const tasks = [mk({ dueDate: '2026-10-16' }), mk()];
  const { blocks, unscheduled, summary } = generateSchedule(tasks, inverted, now);
  assert.strictEqual(blocks.length, 0);
  assert.strictEqual(unscheduled.length, 2);
  assert.strictEqual(summary.capacityPerDay, 0);
  assert.deepStrictEqual(generateSchedule([], settings, now).blocks, []);
});

test('property: blocks never overlap, stay in the window and never exceed the work', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const tasks = Array.from({ length: 1 + (seed % 9) }, (_, i) =>
      mk({
        id: `s${seed}-${i}`,
        estimateMinutes: 5 + ((seed * 31 + i * 47) % 150),
        minutesSpent: (seed + i) % 4 === 0 ? 10 : 0,
        dueDate: (seed + i) % 3 ? `2026-10-${14 + ((seed + i) % 6)}` : null,
        priority: ['low', 'medium', 'high'][(seed + i) % 3],
      }),
    );
    const late = new Date(`2026-10-15T${String(14 + (seed % 4)).padStart(2, '0')}:${String((seed * 7) % 60).padStart(2, '0')}:00`);
    const { blocks, unscheduled } = generateSchedule(tasks, settings, late);
    let prev = Math.max(toMinutes('15:00'), late.getHours() * 60 + late.getMinutes());
    for (const b of blocks) {
      assert.ok(toMinutes(b.start) >= prev, `seed ${seed}: overlap or past`);
      assert.ok(toMinutes(b.end) <= toMinutes('18:00'));
      prev = toMinutes(b.end);
    }
    const work = tasks.reduce((s, t) => s + Math.max(0, t.estimateMinutes - t.minutesSpent), 0);
    const leftover = unscheduled.reduce((s, u) => s + u.minutesLeft, 0);
    assert.strictEqual(focusMinutes(blocks) + leftover, work, `seed ${seed}: minutes lost`);
  }
});
