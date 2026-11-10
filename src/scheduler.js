'use strict';

/**
 * Schedule generation.
 *
 * 1. Work out how many minutes of focused work fit in today's window and in a
 *    full day (focus blocks separated by short breaks, a long break every 4th
 *    block).
 * 2. Put every open task on one "work clock" that runs across days. A task due
 *    on day k must be finished by the end of day k's window on that clock;
 *    overdue tasks are due at 0.
 * 3. Ask the optimizer (src/optimizer.js) for the order that minimises
 *    priority-weighted lateness; among equally good orders it prefers ones
 *    that finish a day ahead of each deadline, then important/short work.
 *    Overdue tasks are due at 0, so they are worked off first.
 * 4. Pour that order into today's focus blocks and explain each decision.
 *
 * Anti-procrastination ideas kept from the original planner: big tasks are
 * split into focus-sized chunks, breaks are built in, and a small "quick win"
 * goes first when it does not make anything late.
 */

const { sequence, evaluate } = require('./optimizer');

const PRIORITY_WEIGHT = { high: 0, medium: 1, low: 2 }; // legacy sort rank
const PRIORITY_VALUE = { high: 3, medium: 2, low: 1 }; // optimizer weight w_j
const MIN_BLOCK = 5; // shortest focus block worth scheduling, in minutes
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function toHHMM(totalMinutes) {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Whole days from `now`'s local date to a YYYY-MM-DD string (DST-safe). */
function daysUntil(dateStr, now) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const due = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due - today) / 86400000);
}

function dayLabel(offset, now) {
  if (offset === 0) return 'today';
  if (offset === 1) return 'tomorrow';
  if (offset === -1) return 'yesterday';
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return offset > 0 && offset < 7
    ? WEEKDAYS[d.getDay()]
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The original rule-based order: due date, then priority, then size, with a
 * quick win first when nothing is urgent. Kept as the baseline the optimizer
 * is compared against.
 */
function sortTasks(tasks, now) {
  const today = startOfDay(now).getTime();
  const open = tasks.filter((t) => !t.done);

  const urgency = (t) => {
    if (!t.dueDate) return Infinity;
    return startOfDay(new Date(`${t.dueDate}T00:00:00`)).getTime();
  };

  const sorted = [...open].sort((a, b) => {
    const ua = urgency(a);
    const ub = urgency(b);
    if (ua !== ub) return ua - ub;
    const pa = PRIORITY_WEIGHT[a.priority] ?? 1;
    const pb = PRIORITY_WEIGHT[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;
    return a.estimateMinutes - b.estimateMinutes;
  });

  const anyUrgent = sorted.some((t) => urgency(t) <= today);
  if (!anyUrgent && sorted.length > 1) {
    let smallestIdx = 0;
    sorted.forEach((t, i) => {
      if (t.estimateMinutes < sorted[smallestIdx].estimateMinutes) smallestIdx = i;
    });
    const [quick] = sorted.splice(smallestIdx, 1);
    sorted.unshift(quick);
  }

  return sorted;
}

/**
 * Focus/break slots for a window, assuming continuous work. Independent of
 * the tasks, so the same function gives both the layout and the capacity.
 */
function daySlots(start, end, focus, shortBreak, longBreak) {
  const slots = [];
  let cursor = start;
  let count = 0;
  while (end - cursor >= MIN_BLOCK) {
    const length = Math.min(focus, end - cursor);
    slots.push({ type: 'focus', start: cursor, end: cursor + length });
    cursor += length;
    count += 1;
    const breakLength = count % 4 === 0 ? longBreak : shortBreak;
    if (cursor + breakLength >= end) break;
    slots.push({ type: 'break', start: cursor, end: cursor + breakLength, long: breakLength === longBreak });
    cursor += breakLength;
  }
  return slots;
}

function capacityOf(slots) {
  return slots.reduce((s, x) => s + (x.type === 'focus' ? x.end - x.start : 0), 0);
}

/** Tasks that will miss a deadline they could still have met (not overdue). */
function lateCount(jobs, order) {
  let t = 0;
  let n = 0;
  for (const j of order) {
    t += jobs[j].p;
    if (t > jobs[j].d && !(jobs[j].dueIn < 0)) n += 1;
  }
  return n;
}

/**
 * @param {Array} tasks      tasks from the store
 * @param {Object} settings  { dayStart, dayEnd, focusMinutes, breakMinutes }
 * @param {Date} [now]       injectable for tests
 * @param {Object} [options] { quickWin = true, exactLimit }
 * @returns {{ blocks: Array, unscheduled: Array, plan: Array, summary: Object }}
 */
function generateSchedule(tasks, settings, now = new Date(), options = {}) {
  const { quickWin = true, exactLimit } = options;
  const dayStart = toMinutes(settings.dayStart);
  const dayEnd = toMinutes(settings.dayEnd);
  const focus = Math.max(MIN_BLOCK, settings.focusMinutes);
  const shortBreak = Math.max(1, settings.breakMinutes);
  const longBreak = shortBreak * 3;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  // Start at the later of day start and "now" (rounded up to 5 min) so the
  // schedule is never in the past.
  const cursor = Math.max(dayStart, Math.ceil(nowMinutes / 5) * 5);

  const todaySlots = daySlots(cursor, dayEnd, focus, shortBreak, longBreak);
  const capToday = capacityOf(todaySlots);
  const capFull = capacityOf(daySlots(dayStart, dayEnd, focus, shortBreak, longBreak));

  // ---- 1. Tasks -> jobs on the cross-day work clock ----
  const open = tasks
    .filter((t) => !t.done)
    .map((t) => ({ task: t, remaining: Math.max(0, t.estimateMinutes - (t.minutesSpent || 0)) }))
    .filter((x) => x.remaining > 0);

  const jobs = open.map(({ task, remaining }) => {
    const dueIn = task.dueDate ? daysUntil(task.dueDate, now) : null;
    let d = Infinity;
    if (dueIn !== null) d = dueIn < 0 ? 0 : capToday + dueIn * capFull;
    // Soft target: one full day of focus time before the deadline.
    const s = Number.isFinite(d) ? Math.max(0, d - capFull) : Infinity;
    return { p: remaining, d, s, w: PRIORITY_VALUE[task.priority] ?? 2, dueIn };
  });

  // ---- 2. Optimize ----
  const result = sequence(jobs, { exactLimit });
  let order = result.order;
  let quickWinIdx = -1;

  if (quickWin && order.length > 1) {
    // Smallest task that fits in one focus block; lead with it only if that
    // makes nothing (more) late.
    let q = -1;
    for (const j of order) {
      if (jobs[j].p <= focus && (q < 0 || jobs[j].p < jobs[q].p)) q = j;
    }
    if (q >= 0 && order[0] !== q) {
      const moved = [q, ...order.filter((j) => j !== q)];
      if (evaluate(jobs, moved).tardiness === result.tardiness) {
        order = moved;
        quickWinIdx = q;
      }
    } else if (q >= 0) {
      quickWinIdx = q;
    }
  }
  const cost = evaluate(jobs, order);

  // ---- 3. Explain ----
  const plan = [];
  let clock = 0;
  for (const j of order) {
    const { task } = open[j];
    const job = jobs[j];
    clock += job.p;
    let finishDay;
    if (clock <= capToday) finishDay = 0;
    else finishDay = capFull > 0 ? Math.ceil((clock - capToday) / capFull) : Infinity;
    const late = clock > job.d;
    const daysLate = late && job.dueIn !== null ? Math.max(0, finishDay - job.dueIn) : 0;

    let reason;
    if (job.dueIn !== null && job.dueIn < 0) {
      reason = `Overdue since ${dayLabel(job.dueIn, now)} - get it done first`;
    } else if (late) {
      reason = Number.isFinite(finishDay)
        ? `Can't fit before it's due (${dayLabel(job.dueIn, now)}) - scheduled as early as the higher-priority work allows`
        : `Can't fit before it's due (${dayLabel(job.dueIn, now)}) - your day window has no room`;
    } else if (j === quickWinIdx) {
      reason = 'Quick win to build momentum';
    } else if (job.dueIn === 0) {
      reason = 'Due today';
    } else if (job.dueIn !== null) {
      reason = `Due ${dayLabel(job.dueIn, now)}`;
    } else {
      reason = 'No due date - fills spare time';
    }

    plan.push({
      taskId: task.id,
      title: task.title,
      minutes: job.p,
      priority: task.priority || 'medium',
      dueDate: task.dueDate || null,
      finishesOn: Number.isFinite(finishDay) ? dayLabel(finishDay, now) : null,
      late,
      daysLate,
      reason,
    });
  }

  // ---- 4. Lay today's part into focus blocks ----
  const blocks = [];
  const minutesToday = new Map();
  let k = 0; // index into order
  let left = order.length ? jobs[order[0]].p : 0;
  for (const slot of todaySlots) {
    if (k >= order.length) break;
    if (slot.type === 'break') {
      blocks.push({
        type: 'break',
        taskId: null,
        title: slot.long ? 'Long break - stretch, snack, water' : 'Short break',
        part: null,
        start: toHHMM(slot.start),
        end: toHHMM(slot.end),
        minutes: slot.end - slot.start,
      });
      continue;
    }
    let t = slot.start;
    while (t < slot.end && k < order.length) {
      const seg = Math.min(slot.end - t, left);
      const { task } = open[order[k]];
      blocks.push({
        type: 'focus',
        taskId: task.id,
        title: task.title,
        part: null,
        start: toHHMM(t),
        end: toHHMM(t + seg),
        minutes: seg,
        reason: plan[k].reason,
      });
      minutesToday.set(task.id, (minutesToday.get(task.id) || 0) + seg);
      t += seg;
      left -= seg;
      if (left === 0) {
        k += 1;
        left = k < order.length ? jobs[order[k]].p : 0;
      }
    }
  }
  // Drop a trailing break; it's pointless at the end of the plan.
  while (blocks.length && blocks[blocks.length - 1].type === 'break') blocks.pop();

  // Number the pieces of tasks that are split across several blocks.
  const pieces = new Map();
  for (const b of blocks) if (b.type === 'focus') pieces.set(b.taskId, (pieces.get(b.taskId) || 0) + 1);
  const seen = new Map();
  for (const b of blocks) {
    if (b.type !== 'focus' || pieces.get(b.taskId) < 2) continue;
    const i = (seen.get(b.taskId) || 0) + 1;
    seen.set(b.taskId, i);
    b.part = `${i}/${pieces.get(b.taskId)}`;
  }

  const unscheduled = [];
  order.forEach((j, idx) => {
    const { task, remaining } = open[j];
    const done = minutesToday.get(task.id) || 0;
    if (done >= remaining) return;
    unscheduled.push({
      taskId: task.id,
      title: task.title,
      minutesLeft: remaining - done,
      reason: done > 0 ? 'Partly scheduled - day window is full' : 'No room left today',
      plannedFinish: plan[idx].finishesOn,
      late: plan[idx].late,
    });
  });

  // ---- Baseline: the old rule-based order, scored with the same model ----
  const indexOf = new Map(open.map((x, i) => [x.task.id, i]));
  const legacy = sortTasks(tasks, now)
    .map((t) => indexOf.get(t.id))
    .filter((i) => i !== undefined);
  const legacyCost = evaluate(jobs, legacy);

  const summary = {
    method: result.method,
    optimal: result.optimal,
    tasksConsidered: jobs.length,
    capacityToday: capToday,
    capacityPerDay: capFull,
    overdueTasks: jobs.filter((j) => j.dueIn !== null && j.dueIn < 0).length,
    lateTasks: lateCount(jobs, order),
    weightedLateMinutes: cost.tardiness,
    baseline: {
      lateTasks: lateCount(jobs, legacy),
      weightedLateMinutes: legacyCost.tardiness,
    },
  };

  return { blocks, unscheduled, plan, summary };
}

module.exports = { generateSchedule, sortTasks, daySlots, toMinutes, toHHMM, PRIORITY_VALUE };
