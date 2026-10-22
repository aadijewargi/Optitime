'use strict';

// ---------- Identity (anonymous, stored in this browser) ----------
function getUserId() {
  let id = localStorage.getItem('ff-user-id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('ff-user-id', id);
  }
  return id;
}
const USER_ID = getUserId();

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': USER_ID,
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.errors ? data.errors.join(', ') : data.error || 'Request failed';
    throw new Error(msg);
  }
  return data;
}

// ---------- State ----------
const state = {
  tasks: [],
  settings: { dayStart: '15:30', dayEnd: '21:00', focusMinutes: 25, breakMinutes: 5 },
  selectedTaskId: null,
};

const $ = (id) => document.getElementById(id);

// ---------- Rendering ----------
function renderTasks() {
  const list = $('task-list');
  list.innerHTML = '';
  $('task-empty').hidden = state.tasks.length > 0;

  const sorted = [...state.tasks].sort((a, b) => Number(a.done) - Number(b.done));
  for (const task of sorted) {
    const li = document.createElement('li');
    if (task.done) li.classList.add('done');
    if (task.id === state.selectedTaskId) li.classList.add('selected');

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = task.done;
    check.setAttribute('aria-label', `Mark "${task.title}" as done`);
    check.addEventListener('change', async () => {
      await api(`/tasks/${task.id}`, { method: 'PATCH', body: { done: check.checked } });
      await refreshAll();
    });

    const info = document.createElement('div');
    info.className = 'info';
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = task.title; // textContent: safe against HTML injection
    const meta = document.createElement('span');
    meta.className = 'meta';
    const due = task.dueDate ? ` · due ${task.dueDate}` : '';
    meta.textContent = `${task.minutesSpent}/${task.estimateMinutes} min${due} `;
    const badge = document.createElement('span');
    badge.className = `badge ${task.priority}`;
    badge.textContent = task.priority;
    meta.appendChild(badge);
    info.append(title, meta);

    const focusBtn = document.createElement('button');
    focusBtn.className = 'icon-btn';
    focusBtn.textContent = task.id === state.selectedTaskId ? 'Selected' : 'Focus';
    focusBtn.disabled = task.done;
    focusBtn.addEventListener('click', () => selectTask(task.id));

    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.textContent = 'Delete';
    del.setAttribute('aria-label', `Delete "${task.title}"`);
    del.addEventListener('click', async () => {
      await api(`/tasks/${task.id}`, { method: 'DELETE' });
      if (state.selectedTaskId === task.id) selectTask(null);
      await refreshAll();
    });

    li.append(check, info, focusBtn, del);
    list.appendChild(li);
  }
}

async function renderSchedule() {
  const { blocks, unscheduled } = await api('/schedule');
  const list = $('schedule-list');
  list.innerHTML = '';
  $('schedule-empty').hidden = blocks.length > 0;

  for (const block of blocks) {
    const li = document.createElement('li');
    if (block.type === 'break') li.classList.add('break');
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = `${block.start}–${block.end}`;
    const label = document.createElement('span');
    label.textContent = block.part ? `${block.title} (${block.part})` : block.title;
    li.append(time, label);
    list.appendChild(li);
  }

  const box = $('unscheduled');
  if (unscheduled.length) {
    box.hidden = false;
    box.textContent =
      "Didn't fit today: " +
      unscheduled.map((u) => `${u.title} (${u.minutesLeft} min left)`).join('; ') +
      '. Consider moving them to tomorrow.';
  } else {
    box.hidden = true;
  }
}

async function renderStats() {
  const stats = await api('/stats');
  $('stat-focus').textContent = stats.focusToday;
  $('stat-done').textContent = stats.completedToday;
  $('stat-streak').textContent = stats.streak;
}

function renderSettings() {
  $('set-start').value = state.settings.dayStart;
  $('set-end').value = state.settings.dayEnd;
  $('set-focus').value = state.settings.focusMinutes;
  $('set-break').value = state.settings.breakMinutes;
}

async function refreshAll() {
  state.tasks = await api('/tasks');
  renderTasks();
  await Promise.all([renderSchedule(), renderStats()]);
}

// ---------- Timer ----------
const timer = {
  mode: 'focus', // 'focus' | 'break'
  totalSeconds: 25 * 60,
  remaining: 25 * 60,
  endsAt: null, // timestamp when running; avoids drift in background tabs
  interval: null,
};

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function setTimerMode(mode) {
  timer.mode = mode;
  const minutes = mode === 'focus' ? state.settings.focusMinutes : state.settings.breakMinutes;
  timer.totalSeconds = minutes * 60;
  timer.remaining = timer.totalSeconds;
  timer.endsAt = null;
  $('timer-mode').textContent = mode === 'focus' ? 'Focus' : 'Break';
  $('timer-mode').classList.toggle('break', mode === 'break');
  $('timer-progress').classList.toggle('break', mode === 'break');
  renderTimer();
}

function renderTimer() {
  $('timer-display').textContent = formatTime(timer.remaining);
  const pct = ((timer.totalSeconds - timer.remaining) / timer.totalSeconds) * 100;
  $('timer-progress').style.width = `${pct}%`;
  document.title = timer.interval
    ? `${formatTime(timer.remaining)} · OptiTime`
    : 'OptiTime';
}

function selectTask(id) {
  state.selectedTaskId = id;
  const task = state.tasks.find((t) => t.id === id);
  $('timer-task').textContent = task ? `Working on: ${task.title}` : 'Pick a task below, then press start.';
  renderTasks();
}

function tick() {
  timer.remaining = Math.max(0, Math.round((timer.endsAt - Date.now()) / 1000));
  renderTimer();
  if (timer.remaining === 0) finishInterval();
}

async function finishInterval() {
  clearInterval(timer.interval);
  timer.interval = null;
  const finishedMode = timer.mode;
  const minutes = Math.round(timer.totalSeconds / 60);

  try {
    await api('/sessions', {
      method: 'POST',
      body: { minutes, type: finishedMode, taskId: finishedMode === 'focus' ? state.selectedTaskId : null },
    });
  } catch (err) {
    console.error('Could not save session', err);
  }

  beep();
  setTimerMode(finishedMode === 'focus' ? 'break' : 'focus');
  setTimerButtons(false);
  await refreshAll();
}

function setTimerButtons(running) {
  $('timer-start').disabled = running;
  $('timer-pause').disabled = !running;
  $('timer-reset').disabled = !running && timer.remaining === timer.totalSeconds;
}

function startTimer() {
  if (timer.interval) return;
  timer.endsAt = Date.now() + timer.remaining * 1000;
  timer.interval = setInterval(tick, 250);
  setTimerButtons(true);
}

function pauseTimer() {
  if (!timer.interval) return;
  clearInterval(timer.interval);
  timer.interval = null;
  timer.endsAt = null;
  $('timer-start').textContent = 'Resume';
  setTimerButtons(false);
  renderTimer();
}

function resetTimer() {
  clearInterval(timer.interval);
  timer.interval = null;
  $('timer-start').textContent = 'Start';
  setTimerMode(timer.mode);
  setTimerButtons(false);
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (_) { /* audio not available; ignore */ }
}

// ---------- Event wiring ----------
$('timer-start').addEventListener('click', startTimer);
$('timer-pause').addEventListener('click', pauseTimer);
$('timer-reset').addEventListener('click', resetTimer);
$('schedule-refresh').addEventListener('click', renderSchedule);

$('task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('form-error').textContent = '';
  try {
    await api('/tasks', {
      method: 'POST',
      body: {
        title: $('task-title').value,
        estimateMinutes: Number($('task-estimate').value),
        dueDate: $('task-due').value || null,
        priority: $('task-priority').value,
      },
    });
    e.target.reset();
    $('task-estimate').value = 30;
    $('task-priority').value = 'medium';
    await refreshAll();
  } catch (err) {
    $('form-error').textContent = err.message;
  }
});

$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    state.settings = await api('/settings', {
      method: 'PUT',
      body: {
        dayStart: $('set-start').value,
        dayEnd: $('set-end').value,
        focusMinutes: Number($('set-focus').value),
        breakMinutes: Number($('set-break').value),
      },
    });
    $('settings-msg').textContent = 'Saved.';
    if (!timer.interval) setTimerMode(timer.mode);
    await renderSchedule();
  } catch (err) {
    $('settings-msg').textContent = err.message;
  }
});

// ---------- Boot ----------
(async function init() {
  try {
    state.settings = await api('/settings');
    renderSettings();
    setTimerMode('focus');
    setTimerButtons(false);
    await refreshAll();
  } catch (err) {
    $('form-error').textContent = `Could not load your data: ${err.message}`;
  }
})();
