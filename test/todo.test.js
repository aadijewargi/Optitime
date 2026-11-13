'use strict';

const test = require('node:test');
const assert = require('node:assert');
const core = require('../extension/lib/core');

// Builds a list with fixed ids and times so results are easy to compare.
function listOf(...texts) {
  let todos = [];
  texts.forEach((text, i) => {
    todos = core.addTodo(todos, text, 1000 + i, `id${i}`).todos;
  });
  return todos;
}

const texts = (todos) => todos.map((t) => t.text);

test('addTodo trims, collapses spaces and appends', () => {
  const r = core.addTodo([], '  finish   math\nworksheet  ', 5, 'a');
  assert.deepStrictEqual(r.todos, [
    { id: 'a', text: 'finish math worksheet', done: false, createdAt: 5, doneAt: null },
  ]);
  const r2 = core.addTodo(r.todos, 'read ch. 4', 6, 'b');
  assert.deepStrictEqual(texts(r2.todos), ['finish math worksheet', 'read ch. 4']);
  assert.strictEqual(r.todos.length, 1, 'input list is not mutated');
});

test('addTodo rejects empty, too-long and over-capacity input', () => {
  assert.ok(core.addTodo([], '').error);
  assert.ok(core.addTodo([], '   \n ').error);
  assert.ok(core.addTodo([], null).error);
  assert.ok(core.addTodo([], 'x'.repeat(core.MAX_TODO_LENGTH + 1)).error);
  assert.ok(core.addTodo([], 'x'.repeat(core.MAX_TODO_LENGTH)).todos);
  const full = Array.from({ length: core.MAX_TODOS }, (_, i) => ({ id: `${i}`, text: 't', done: false }));
  assert.ok(core.addTodo(full, 'one more').error);
  assert.ok(core.addTodo(undefined, 'works on a missing list').todos);
});

test('addTodo makes unique ids by default', () => {
  let todos = [];
  for (let i = 0; i < 50; i++) todos = core.addTodo(todos, `t${i}`, 42).todos;
  assert.strictEqual(new Set(todos.map((t) => t.id)).size, 50);
});

test('toggleTodo marks done with a time and back again', () => {
  let todos = listOf('a', 'b');
  todos = core.toggleTodo(todos, 'id1', 99);
  assert.deepStrictEqual(todos.map((t) => [t.done, t.doneAt]), [[false, null], [true, 99]]);
  todos = core.toggleTodo(todos, 'id1', 100);
  assert.deepStrictEqual(todos.map((t) => [t.done, t.doneAt]), [[false, null], [false, null]]);
  assert.deepStrictEqual(core.toggleTodo(todos, 'missing', 1), todos);
});

test('editTodo renames, and leaves the list alone on bad input', () => {
  const todos = listOf('a', 'b');
  assert.deepStrictEqual(texts(core.editTodo(todos, 'id0', '  A!  ').todos), ['A!', 'b']);
  assert.ok(core.editTodo(todos, 'id0', '   ').error);
});

test('removeTodo and clearDoneTodos', () => {
  let todos = listOf('a', 'b', 'c');
  assert.deepStrictEqual(texts(core.removeTodo(todos, 'id1')), ['a', 'c']);
  todos = core.toggleTodo(core.toggleTodo(todos, 'id0', 1), 'id2', 2);
  assert.deepStrictEqual(texts(core.clearDoneTodos(todos)), ['b']);
  assert.deepStrictEqual(core.clearDoneTodos([]), []);
});

test('moveTodo swaps neighbouring unfinished items and skips finished ones', () => {
  let todos = listOf('a', 'b', 'c', 'd');
  assert.deepStrictEqual(texts(core.moveTodo(todos, 'id2', -1)), ['a', 'c', 'b', 'd']);
  assert.deepStrictEqual(texts(core.moveTodo(todos, 'id0', -1)), ['a', 'b', 'c', 'd'], 'top stays put');
  assert.deepStrictEqual(texts(core.moveTodo(todos, 'id3', 1)), ['a', 'b', 'c', 'd'], 'bottom stays put');
  todos = core.toggleTodo(todos, 'id1', 5); // b is done
  // c moves up past the finished b and swaps with a; b keeps its slot.
  assert.deepStrictEqual(texts(core.moveTodo(todos, 'id2', -1)), ['c', 'b', 'a', 'd']);
  assert.deepStrictEqual(texts(core.moveTodo(todos, 'id1', 1)), ['a', 'b', 'c', 'd'], 'finished items do not move');
  assert.deepStrictEqual(texts(core.moveTodo(todos, 'nope', 1)), ['a', 'b', 'c', 'd']);
});

test('moveTodo matches a brute-force reference on random lists', () => {
  // Reference: take the unfinished items out, swap them, put them back in the same slots.
  function reference(todos, id, delta) {
    const slots = [];
    const open = [];
    todos.forEach((t, i) => { if (!t.done) { slots.push(i); open.push(t); } });
    const at = open.findIndex((t) => t.id === id);
    if (at < 0 || at + delta < 0 || at + delta >= open.length) return todos;
    [open[at], open[at + delta]] = [open[at + delta], open[at]];
    const out = [...todos];
    slots.forEach((slot, k) => { out[slot] = open[k]; });
    return out;
  }
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let trial = 0; trial < 500; trial++) {
    const n = Math.floor(rand() * 7);
    const todos = Array.from({ length: n }, (_, i) => ({ id: `t${i}`, text: `t${i}`, done: rand() < 0.4 }));
    const id = `t${Math.floor(rand() * (n + 1))}`;
    const delta = rand() < 0.5 ? -1 : 1;
    assert.deepStrictEqual(core.moveTodo(todos, id, delta), reference(todos, id, delta));
  }
});

test('sortTodos puts open items first, then finished ones newest first', () => {
  let todos = listOf('a', 'b', 'c', 'd');
  todos = core.toggleTodo(todos, 'id0', 10);
  todos = core.toggleTodo(todos, 'id2', 20);
  assert.deepStrictEqual(texts(core.sortTodos(todos)), ['b', 'd', 'c', 'a']);
  assert.deepStrictEqual(core.sortTodos(undefined), []);
});

test('todoCounts', () => {
  const todos = core.toggleTodo(listOf('a', 'b', 'c'), 'id1', 1);
  assert.deepStrictEqual(core.todoCounts(todos), { total: 3, done: 1, open: 2 });
  assert.deepStrictEqual(core.todoCounts(undefined), { total: 0, done: 0, open: 0 });
});
