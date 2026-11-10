'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  evaluate,
  solveExact,
  solveHeuristic,
  sequence,
  eddOrder,
  wsptOrder,
} = require('../src/optimizer');

// Small deterministic PRNG so failures are reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomJobs(n, rand) {
  const jobs = [];
  for (let i = 0; i < n; i++) {
    const p = 5 + Math.floor(rand() * 120);
    const w = 1 + Math.floor(rand() * 3);
    // ~20% without deadline, otherwise a deadline anywhere in a tight horizon
    const d = rand() < 0.2 ? Infinity : Math.floor(rand() * n * 50);
    jobs.push({ p, d, w });
  }
  return jobs;
}

function* permutations(arr) {
  if (arr.length <= 1) {
    yield arr.slice();
    return;
  }
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) yield [arr[i], ...p];
  }
}

function bruteForce(jobs) {
  let best = null;
  for (const order of permutations(jobs.map((_, i) => i))) {
    const c = evaluate(jobs, order);
    if (
      !best ||
      c.tardiness < best.tardiness ||
      (c.tardiness === best.tardiness && c.weightedCompletion < best.weightedCompletion)
    ) {
      best = { order, ...c };
    }
  }
  return best;
}

test('evaluate computes weighted tardiness and completion by hand', () => {
  const jobs = [
    { p: 30, d: 20, w: 2 }, // finishes 30 -> 10 late -> 20
    { p: 10, d: 100, w: 1 }, // finishes 40 -> on time
    { p: 20, d: 50, w: 3 }, // finishes 60 -> 10 late -> 30
  ];
  assert.deepStrictEqual(evaluate(jobs, [0, 1, 2]), {
    tardiness: 50,
    weightedCompletion: 2 * 30 + 1 * 40 + 3 * 60,
  });
});

test('exact DP matches brute force on 300 random instances (n = 1..7)', () => {
  const rand = rng(42);
  for (let trial = 0; trial < 300; trial++) {
    const jobs = randomJobs(1 + (trial % 7), rand);
    const dp = solveExact(jobs);
    const bf = bruteForce(jobs);
    assert.strictEqual(dp.tardiness, bf.tardiness, `trial ${trial}`);
    assert.strictEqual(dp.weightedCompletion, bf.weightedCompletion, `trial ${trial}`);
    // The returned order really achieves the reported cost and is a permutation.
    assert.deepStrictEqual(evaluate(jobs, dp.order), {
      tardiness: dp.tardiness,
      weightedCompletion: dp.weightedCompletion,
    });
    assert.deepStrictEqual([...dp.order].sort((a, b) => a - b), jobs.map((_, i) => i));
  }
});

test('reduces to known special cases', () => {
  // No deadlines at all: optimal is Smith's WSPT rule.
  const free = [
    { p: 50, d: Infinity, w: 1 },
    { p: 10, d: Infinity, w: 1 },
    { p: 30, d: Infinity, w: 4 },
  ];
  assert.deepStrictEqual(solveExact(free).order, wsptOrder(free));

  // Feasible deadlines (EDD meets them all): tardiness must be zero.
  const easy = [
    { p: 20, d: 60, w: 1 },
    { p: 20, d: 20, w: 1 },
    { p: 20, d: 40, w: 1 },
  ];
  assert.strictEqual(evaluate(easy, eddOrder(easy)).tardiness, 0);
  assert.strictEqual(solveExact(easy).tardiness, 0);
});

test('sacrifices one low-priority job instead of making two important ones late', () => {
  // Overloaded: 60 min of capacity "today" (d = 60) for 100 min of work.
  // EDD does the big low-priority job first and makes both high-priority jobs late.
  const jobs = [
    { p: 60, d: 60, w: 1 }, // big, low priority, due today
    { p: 20, d: 80, w: 3 }, // high, due a bit later
    { p: 20, d: 80, w: 3 },
  ];
  const edd = evaluate(jobs, eddOrder(jobs));
  const opt = solveExact(jobs);
  assert.strictEqual(edd.tardiness, 3 * 0 + 3 * 20); // second high job 20 late
  assert.strictEqual(opt.tardiness, 40); // low job 40 late, weight 1
  assert.ok(opt.tardiness < edd.tardiness);
  assert.deepStrictEqual(opt.order.slice(-1), [0]);
});

test('edge cases: empty, single job, identical jobs, all overdue', () => {
  assert.deepStrictEqual(solveExact([]).order, []);
  assert.deepStrictEqual(solveHeuristic([]).order, []);
  assert.deepStrictEqual(solveExact([{ p: 5, d: 0, w: 1 }]).order, [0]);

  const same = Array.from({ length: 6 }, () => ({ p: 25, d: 50, w: 2 }));
  assert.strictEqual(solveExact(same).tardiness, bruteForce(same).tardiness);

  // Everything overdue (d = 0): tardiness == weighted completion, WSPT is optimal.
  const overdue = [
    { p: 40, d: 0, w: 1 },
    { p: 10, d: 0, w: 2 },
    { p: 25, d: 0, w: 3 },
  ];
  assert.strictEqual(solveExact(overdue).tardiness, evaluate(overdue, wsptOrder(overdue)).tardiness);
});

test('sequence validates input and picks the solver by size', () => {
  assert.throws(() => sequence([{ p: 0, d: 10, w: 1 }]), TypeError);
  assert.throws(() => sequence([{ p: 10, d: NaN, w: 1 }]), TypeError);
  const rand = rng(7);
  assert.strictEqual(sequence(randomJobs(5, rand)).method, 'exact');
  const big = sequence(randomJobs(30, rand));
  assert.strictEqual(big.method, 'heuristic');
  assert.strictEqual(big.optimal, false);
  assert.strictEqual(new Set(big.order).size, 30);
});

test('heuristic is never worse than EDD or WSPT and close to optimal (n = 10)', () => {
  const rand = rng(2026);
  let gapSum = 0;
  let exactHits = 0;
  const trials = 40;
  for (let trial = 0; trial < trials; trial++) {
    const jobs = randomJobs(10, rand);
    const h = solveHeuristic(jobs);
    const opt = solveExact(jobs);
    assert.ok(h.tardiness >= opt.tardiness, 'heuristic cannot beat the optimum');
    assert.ok(h.tardiness <= evaluate(jobs, eddOrder(jobs)).tardiness);
    assert.ok(h.tardiness <= evaluate(jobs, wsptOrder(jobs)).tardiness);
    if (h.tardiness === opt.tardiness) exactHits++;
    gapSum += opt.tardiness ? (h.tardiness - opt.tardiness) / opt.tardiness : 0;
  }
  assert.ok(exactHits / trials >= 0.7, `heuristic optimal on only ${exactHits}/${trials}`);
  assert.ok(gapSum / trials < 0.05, `mean gap ${(100 * gapSum) / trials}%`);
});
