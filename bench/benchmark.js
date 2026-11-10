'use strict';

/**
 * Compares three ways to order a student's task list on random, realistic
 * instances:
 *   - rules:     the original planner (due date, then priority, then size)
 *   - heuristic: ATC dispatching + insertion local search
 *   - exact:     subset dynamic program (optimal)
 * and times the solvers. Run: node bench/benchmark.js
 */

const { evaluate, solveExact, solveHeuristic } = require('../src/optimizer');

const CAP = 145; // focus minutes in a 15:00-18:00 day with 25/5 blocks
const WEIGHT = [1, 2, 3]; // low, medium, high

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

/** n tasks of 15-120 min, due within 0-3 days or undated, random priority. */
function instance(n, rand) {
  return Array.from({ length: n }, () => {
    const p = 15 + 5 * Math.floor(rand() * 22);
    const w = WEIGHT[Math.floor(rand() * 3)];
    const due = rand() < 0.15 ? null : Math.floor(rand() * 4);
    const d = due === null ? Infinity : CAP * (due + 1);
    return { p, w, d, s: Number.isFinite(d) ? Math.max(0, d - CAP) : Infinity };
  });
}

function rulesOrder(jobs) {
  return jobs.map((_, i) => i).sort((a, b) => jobs[a].d - jobs[b].d || jobs[b].w - jobs[a].w || jobs[a].p - jobs[b].p);
}

function time(fn) {
  const t = process.hrtime.bigint();
  const r = fn();
  return [r, Number(process.hrtime.bigint() - t) / 1e6];
}

const lines = [];
lines.push('| tasks | instances | rules: mean weighted late min | heuristic | exact | rules worse than optimal | heuristic optimal | exact time (ms) | heuristic time (ms) |');
lines.push('|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const n of [6, 8, 10, 12, 14, 16, 18]) {
  const rand = rng(1000 + n);
  const trials = n <= 14 ? 200 : 40;
  let sumRules = 0;
  let sumH = 0;
  let sumX = 0;
  let rulesWorse = 0;
  let hOpt = 0;
  let tX = 0;
  let tH = 0;
  for (let k = 0; k < trials; k++) {
    const jobs = instance(n, rand);
    const r = evaluate(jobs, rulesOrder(jobs));
    const [h, th] = time(() => solveHeuristic(jobs));
    const [x, tx] = time(() => solveExact(jobs));
    sumRules += r.tardiness;
    sumH += h.tardiness;
    sumX += x.tardiness;
    if (r.tardiness > x.tardiness) rulesWorse++;
    if (h.tardiness === x.tardiness) hOpt++;
    tX += tx;
    tH += th;
  }
  const pct = (a) => `${((100 * a) / trials).toFixed(1)}%`;
  lines.push(
    `| ${n} | ${trials} | ${(sumRules / trials).toFixed(0)} | ${(sumH / trials).toFixed(0)} | ${(sumX / trials).toFixed(0)} | ${pct(rulesWorse)} | ${pct(hOpt)} | ${(tX / trials).toFixed(1)} | ${(tH / trials).toFixed(1)} |`,
  );
}

const big = [];
for (const n of [30, 60, 100]) {
  const jobs = instance(n, rng(n));
  const [h, th] = time(() => solveHeuristic(jobs));
  const r = evaluate(jobs, rulesOrder(jobs));
  big.push(`| ${n} | ${r.tardiness} | ${h.tardiness} | ${th.toFixed(0)} |`);
}

console.log(lines.join('\n'));
console.log('\n| tasks | rules: weighted late min | heuristic | heuristic time (ms) |\n|---:|---:|---:|---:|');
console.log(big.join('\n'));
