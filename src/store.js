'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Tiny JSON-file data store. Zero native dependencies, so the project runs
 * anywhere Node runs. Writes are atomic (temp file + rename) and serialized
 * through an in-memory copy.
 *
 * Shape: { users: { [userId]: { tasks: [], sessions: [], settings: {} } } }
 */
class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { users: {} };
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      this.data = JSON.parse(raw);
      if (!this.data.users) this.data.users = {};
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('Could not read data file, starting fresh:', err.message);
      }
      this.data = { users: {} };
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  _user(userId) {
    if (!this.data.users[userId]) {
      this.data.users[userId] = {
        tasks: [],
        sessions: [],
        settings: {
          dayStart: '15:30', // after school
          dayEnd: '21:00',
          focusMinutes: 25,
          breakMinutes: 5,
        },
      };
      this._save();
    }
    return this.data.users[userId];
  }

  // ---- Settings ----
  getSettings(userId) {
    return { ...this._user(userId).settings };
  }

  updateSettings(userId, patch) {
    const user = this._user(userId);
    user.settings = { ...user.settings, ...patch };
    this._save();
    return { ...user.settings };
  }

  // ---- Tasks ----
  listTasks(userId) {
    return this._user(userId).tasks.map((t) => ({ ...t }));
  }

  addTask(userId, { title, estimateMinutes, dueDate, priority }) {
    const task = {
      id: crypto.randomUUID(),
      title,
      estimateMinutes,
      dueDate: dueDate || null,
      priority: priority || 'medium',
      done: false,
      createdAt: new Date().toISOString(),
      completedAt: null,
      minutesSpent: 0,
    };
    this._user(userId).tasks.push(task);
    this._save();
    return { ...task };
  }

  updateTask(userId, taskId, patch) {
    const task = this._user(userId).tasks.find((t) => t.id === taskId);
    if (!task) return null;
    const allowed = ['title', 'estimateMinutes', 'dueDate', 'priority', 'done'];
    for (const key of allowed) {
      if (key in patch) task[key] = patch[key];
    }
    if ('done' in patch) {
      task.completedAt = patch.done ? new Date().toISOString() : null;
    }
    this._save();
    return { ...task };
  }

  deleteTask(userId, taskId) {
    const user = this._user(userId);
    const before = user.tasks.length;
    user.tasks = user.tasks.filter((t) => t.id !== taskId);
    if (user.tasks.length === before) return false;
    this._save();
    return true;
  }

  // ---- Timer sessions ----
  logSession(userId, { taskId, minutes, type }) {
    const user = this._user(userId);
    const session = {
      id: crypto.randomUUID(),
      taskId: taskId || null,
      minutes,
      type: type || 'focus',
      endedAt: new Date().toISOString(),
    };
    user.sessions.push(session);
    if (taskId && session.type === 'focus') {
      const task = user.tasks.find((t) => t.id === taskId);
      if (task) task.minutesSpent += minutes;
    }
    this._save();
    return { ...session };
  }

  listSessions(userId) {
    return this._user(userId).sessions.map((s) => ({ ...s }));
  }

  // ---- Stats ----
  /**
   * @param {number} tzOffset minutes behind UTC, as Date#getTimezoneOffset()
   *   reports it (Los Angeles in summer = 420). Day boundaries use this so
   *   "today" is the user's local day.
   */
  getStats(userId, today = new Date(), tzOffset = 0) {
    const user = this._user(userId);
    const localDay = (when) => new Date(new Date(when).getTime() - tzOffset * 60000).toISOString().slice(0, 10);
    const dayKey = localDay(today);

    const focusToday = user.sessions
      .filter((s) => s.type === 'focus' && localDay(s.endedAt) === dayKey)
      .reduce((sum, s) => sum + s.minutes, 0);
    const completedToday = user.tasks.filter(
      (t) => t.done && t.completedAt && localDay(t.completedAt) === dayKey
    ).length;

    // Streak: consecutive days (ending today or yesterday) with >= 1 focus session
    const days = new Set(user.sessions.filter((s) => s.type === 'focus').map((s) => localDay(s.endedAt)));
    let streak = 0;
    const cursor = new Date(`${dayKey}T00:00:00Z`);
    if (!days.has(dayKey)) cursor.setUTCDate(cursor.getUTCDate() - 1);
    while (days.has(cursor.toISOString().slice(0, 10))) {
      streak += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    return { focusToday, completedToday, streak };
  }
}

module.exports = { Store };
