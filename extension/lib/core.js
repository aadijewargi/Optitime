/*
 * OptiTime core logic. Pure functions, no Chrome APIs, so it can be unit
 * tested in Node and also loaded by the extension (service worker via
 * importScripts, popup/blocked pages via <script>).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OptiCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

  /** "https://www.YouTube.com/watch?v=1" -> "youtube.com". Returns null if invalid. */
  function normalizeDomain(input) {
    if (typeof input !== 'string') return null;
    let s = input.trim().toLowerCase();
    if (!s) return null;
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // protocol
    s = s.split(/[/?#]/)[0]; // path, query, hash
    s = s.replace(/^[^@]*@/, ''); // user:pass@
    s = s.replace(/:\d+$/, ''); // port
    s = s.replace(/^www\./, '');
    s = s.replace(/\.$/, '');
    return DOMAIN_RE.test(s) ? s : null;
  }

  /** True if hostname is the domain or one of its subdomains. */
  function domainMatches(hostname, domain) {
    const h = String(hostname || '').toLowerCase().replace(/^www\./, '');
    return h === domain || h.endsWith('.' + domain);
  }

  /** Finds the configured site (most specific match) for a hostname. */
  function findSite(hostname, sites) {
    let best = null;
    for (const site of sites) {
      if (domainMatches(hostname, site.domain)) {
        if (!best || site.domain.length > best.domain.length) best = site;
      }
    }
    return best;
  }

  /** Local-time calendar day key, e.g. "2026-10-22". */
  function dayKey(date) {
    const d = date || new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  /** Domains whose usage has reached their limit. A limit of 0 blocks always. */
  function computeBlocked(sites, seconds) {
    const used = seconds || {};
    return sites
      .filter((s) => (used[s.domain] || 0) >= s.limitMinutes * 60)
      .map((s) => s.domain);
  }

  function addSite(sites, domainInput, limitMinutes) {
    const domain = normalizeDomain(domainInput);
    if (!domain) return { error: 'Enter a valid site like youtube.com' };
    const limit = Number(limitMinutes);
    if (!Number.isInteger(limit) || limit < 0 || limit > 1440) {
      return { error: 'Limit must be a whole number from 0 to 1440 minutes' };
    }
    const existing = sites.find((s) => s.domain === domain);
    if (existing) {
      return { sites: sites.map((s) => (s.domain === domain ? { domain, limitMinutes: limit } : s)) };
    }
    return { sites: [...sites, { domain, limitMinutes: limit }] };
  }

  function removeSite(sites, domain) {
    return sites.filter((s) => s.domain !== domain);
  }

  /** "1h 5m", "12m", "30s" */
  function formatDuration(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `${h}h ${rem}m` : `${h}h`;
  }

  // ---- To-do list ----
  // A todo is { id, text, done, createdAt, doneAt }. Every function returns a
  // new array and never mutates its input, so storage writes stay simple.

  const MAX_TODO_LENGTH = 200;
  const MAX_TODOS = 200;

  /** Collapses whitespace and checks length. Returns { text } or { error }. */
  function cleanTodoText(input) {
    const text = String(input == null ? '' : input).replace(/\s+/g, ' ').trim();
    if (!text) return { error: 'Type something to do first' };
    if (text.length > MAX_TODO_LENGTH) {
      return { error: `Keep it under ${MAX_TODO_LENGTH} characters` };
    }
    return { text };
  }

  function makeId(now) {
    return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Adds an item to the end of the list. `now` and `id` are injectable for tests. */
  function addTodo(todos, input, now, id) {
    const list = todos || [];
    const cleaned = cleanTodoText(input);
    if (cleaned.error) return { error: cleaned.error };
    if (list.length >= MAX_TODOS) {
      return { error: `Your list is full (${MAX_TODOS} items). Clear some finished ones first` };
    }
    const t = now == null ? Date.now() : now;
    const item = { id: id || makeId(t), text: cleaned.text, done: false, createdAt: t, doneAt: null };
    return { todos: [...list, item] };
  }

  function toggleTodo(todos, id, now) {
    const t = now == null ? Date.now() : now;
    return (todos || []).map((item) =>
      item.id === id ? { ...item, done: !item.done, doneAt: item.done ? null : t } : item
    );
  }

  /** Renames an item. Returns { todos } or { error } (the list is unchanged on error). */
  function editTodo(todos, id, input) {
    const cleaned = cleanTodoText(input);
    if (cleaned.error) return { error: cleaned.error };
    return { todos: (todos || []).map((item) => (item.id === id ? { ...item, text: cleaned.text } : item)) };
  }

  function removeTodo(todos, id) {
    return (todos || []).filter((item) => item.id !== id);
  }

  function clearDoneTodos(todos) {
    return (todos || []).filter((item) => !item.done);
  }

  /**
   * Moves an item `delta` places among the unfinished items (-1 = up, +1 = down).
   * Finished items keep their positions. Out-of-range moves are a no-op.
   */
  function moveTodo(todos, id, delta) {
    const list = [...(todos || [])];
    const open = list.map((item, i) => (item.done ? -1 : i)).filter((i) => i >= 0);
    const at = open.findIndex((i) => list[i].id === id);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= open.length) return list;
    const a = open[at];
    const b = open[to];
    [list[a], list[b]] = [list[b], list[a]];
    return list;
  }

  /** Display order: unfinished items in list order, then finished ones, newest first. */
  function sortTodos(todos) {
    const list = todos || [];
    const open = list.filter((item) => !item.done);
    const done = list.filter((item) => item.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    return [...open, ...done];
  }

  function todoCounts(todos) {
    const list = todos || [];
    const done = list.filter((item) => item.done).length;
    return { total: list.length, done, open: list.length - done };
  }

  return {
    normalizeDomain, domainMatches, findSite, dayKey, computeBlocked, addSite, removeSite, formatDuration,
    MAX_TODO_LENGTH, MAX_TODOS, cleanTodoText, addTodo, toggleTodo, editTodo, removeTodo, clearDoneTodos,
    moveTodo, sortTodos, todoCounts,
  };
});
