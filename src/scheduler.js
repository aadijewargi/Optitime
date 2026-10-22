'use strict';

/**
 * Schedule generation.
 *
 * Takes the user's open tasks and settings and lays them out as a sequence of
 * focus blocks and short breaks inside the day window. Anti-procrastination
 * ideas baked in:
 *   - Urgent work first (due date, then priority).
 *   - Big tasks are split into focus-sized chunks so starting feels easy.
 *   - A short break after every block, a longer one every 4 blocks.
 *   - A "quick win" (smallest task) is placed first when nothing is overdue,
 *     to build momentum.
 */

const PRIORITY_WEIGHT = { high: 0, medium: 1, low: 2 };

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

  // Quick win: if nothing is due today or earlier, lead with the smallest task.
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
 * @param {Array} tasks      tasks from the store
 * @param {Object} settings  { dayStart, dayEnd, focusMinutes, breakMinutes }
 * @param {Date} [now]       injectable for tests
 * @returns {{ blocks: Array, unscheduled: Array }}
 */
function generateSchedule(tasks, settings, now = new Date()) {
  const dayStart = toMinutes(settings.dayStart);
  const dayEnd = toMinutes(settings.dayEnd);
  const focus = Math.max(5, settings.focusMinutes);
  const shortBreak = Math.max(1, settings.breakMinutes);
  const longBreak = shortBreak * 3;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  // Start at the later of day start and "now" (rounded up to 5 min) so the
  // schedule is never in the past.
  let cursor = Math.max(dayStart, Math.ceil(nowMinutes / 5) * 5);

  const blocks = [];
  const unscheduled = [];
  let focusBlockCount = 0;

  for (const task of sortTasks(tasks, now)) {
    const remaining = Math.max(0, task.estimateMinutes - (task.minutesSpent || 0));
    if (remaining === 0) continue;

    let left = remaining;
    let part = 1;
    const totalParts = Math.ceil(remaining / focus);
    let placedAny = false;

    while (left > 0) {
      const length = Math.min(focus, left);
      const breakLength = (focusBlockCount + 1) % 4 === 0 ? longBreak : shortBreak;
      if (cursor + length > dayEnd) break;

      blocks.push({
        type: 'focus',
        taskId: task.id,
        title: task.title,
        part: totalParts > 1 ? `${part}/${totalParts}` : null,
        start: toHHMM(cursor),
        end: toHHMM(cursor + length),
        minutes: length,
      });
      cursor += length;
      left -= length;
      part += 1;
      focusBlockCount += 1;
      placedAny = true;

      // Only add a break if there is more work and room for it.
      if (cursor + breakLength < dayEnd) {
        blocks.push({
          type: 'break',
          taskId: null,
          title: breakLength === longBreak ? 'Long break - stretch, snack, water' : 'Short break',
          part: null,
          start: toHHMM(cursor),
          end: toHHMM(cursor + breakLength),
          minutes: breakLength,
        });
        cursor += breakLength;
      }
    }

    if (left > 0) {
      unscheduled.push({
        taskId: task.id,
        title: task.title,
        minutesLeft: left,
        reason: placedAny ? 'Partly scheduled - day window is full' : 'No room left today',
      });
    }
  }

  // Drop a trailing break; it's pointless at the end of the plan.
  while (blocks.length && blocks[blocks.length - 1].type === 'break') blocks.pop();

  return { blocks, unscheduled };
}

module.exports = { generateSchedule, sortTasks, toMinutes, toHHMM };
