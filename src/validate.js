'use strict';

const PRIORITIES = ['low', 'medium', 'high'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateTask(body, { partial = false } = {}) {
  const errors = [];
  const out = {};

  if (!partial || 'title' in body) {
    if (typeof body.title !== 'string' || !body.title.trim()) {
      errors.push('title is required');
    } else {
      out.title = body.title.trim().slice(0, 120);
    }
  }

  if (!partial || 'estimateMinutes' in body) {
    const n = Number(body.estimateMinutes);
    if (!Number.isInteger(n) || n < 5 || n > 480) {
      errors.push('estimateMinutes must be a whole number between 5 and 480');
    } else {
      out.estimateMinutes = n;
    }
  }

  if ('dueDate' in body && body.dueDate !== null && body.dueDate !== '') {
    if (!DATE_RE.test(body.dueDate) || Number.isNaN(Date.parse(body.dueDate))) {
      errors.push('dueDate must be YYYY-MM-DD');
    } else {
      out.dueDate = body.dueDate;
    }
  } else if ('dueDate' in body) {
    out.dueDate = null;
  }

  if ('priority' in body) {
    if (!PRIORITIES.includes(body.priority)) {
      errors.push(`priority must be one of: ${PRIORITIES.join(', ')}`);
    } else {
      out.priority = body.priority;
    }
  }

  if ('done' in body) {
    if (typeof body.done !== 'boolean') errors.push('done must be true or false');
    else out.done = body.done;
  }

  return { errors, value: out };
}

function validateSettings(body) {
  const errors = [];
  const out = {};

  for (const key of ['dayStart', 'dayEnd']) {
    if (key in body) {
      if (!TIME_RE.test(body[key])) errors.push(`${key} must be HH:MM (24h)`);
      else out[key] = body[key];
    }
  }
  for (const [key, min, max] of [
    ['focusMinutes', 5, 90],
    ['breakMinutes', 1, 30],
  ]) {
    if (key in body) {
      const n = Number(body[key]);
      if (!Number.isInteger(n) || n < min || n > max) {
        errors.push(`${key} must be a whole number between ${min} and ${max}`);
      } else {
        out[key] = n;
      }
    }
  }

  return { errors, value: out };
}

function validateSession(body) {
  const errors = [];
  const out = {};
  const n = Number(body.minutes);
  if (!Number.isInteger(n) || n < 1 || n > 180) {
    errors.push('minutes must be a whole number between 1 and 180');
  } else {
    out.minutes = n;
  }
  if (body.type !== undefined && !['focus', 'break'].includes(body.type)) {
    errors.push('type must be focus or break');
  } else if (body.type) {
    out.type = body.type;
  }
  if (body.taskId !== undefined && body.taskId !== null) {
    if (typeof body.taskId !== 'string') errors.push('taskId must be a string');
    else out.taskId = body.taskId;
  }
  return { errors, value: out };
}

module.exports = { validateTask, validateSettings, validateSession };
