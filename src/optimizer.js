'use strict';

/**
 * Task sequencing engine.
 *
 * Problem: one person (a single "machine") has n jobs. Job j needs p_j minutes
 * of work, is due at work-time d_j (Infinity = no deadline) and has a weight
 * w_j (its priority). If a job finishes at C_j its tardiness is
 * T_j = max(0, C_j - d_j). We look for the order that minimises, in this order
 * of importance:
 *
 *   1. total weighted tardiness   sum_j w_j * T_j
 *   2. total weighted completion  sum_j w_j * C_j   (tie-breaker: finish
 *      important and short work early when no deadline is at stake)
 *
 * In scheduling notation the primary objective is 1 || sum w_j T_j, which is
 * strongly NP-hard (Lenstra, Rinnooy Kan & Brucker, 1977). Two solvers:
 *
 *   - solveExact:     dynamic programming over subsets, O(2^n * n) time and
 *                     O(2^n) memory. Optimal; used for small n.
 *   - solveHeuristic: Apparent Tardiness Cost dispatching (Vepsalainen &
 *                     Morton, 1987) plus EDD / WSPT starts, each polished by
 *                     insertion local search. Fast, not guaranteed optimal.
 *
 * All jobs are available now, so splitting a job into pieces (preemption)
 * can never improve a regular objective like this one; an optimal order of
 * whole jobs is optimal among all schedules. The caller is free to cut the
 * resulting sequence into focus blocks afterwards.
 */

const DEFAULT_EXACT_LIMIT = 18;

/** Lexicographic "a is better than b" for [tardiness, completion] pairs. */
function better(t1, f1, t2, f2) {
  return t1 < t2 || (t1 === t2 && f1 < f2);
}

/**
 * Cost of processing jobs in the given order starting at work-time 0.
 * @param {Array<{p:number,d:number,w:number}>} jobs
 * @param {number[]} order  indices into jobs
 */
function evaluate(jobs, order) {
  let t = 0;
  let tardiness = 0;
  let weightedCompletion = 0;
  for (const j of order) {
    const { p, d, w } = jobs[j];
    t += p;
    if (t > d) tardiness += w * (t - d);
    weightedCompletion += w * t;
  }
  return { tardiness, weightedCompletion };
}

/**
 * Exact DP. dp[S] = best cost of doing exactly the jobs in bitmask S first.
 * Whatever order S is done in, the last job of S finishes at p(S), so
 *   dp[S] = min over j in S of dp[S \ {j}] + cost_j(p(S)).
 */
function solveExact(jobs) {
  const n = jobs.length;
  if (n === 0) return { order: [], ...evaluate(jobs, []) };
  if (n > 24) throw new RangeError(`solveExact: n=${n} is too large (2^n states)`);

  const N = 1 << n;
  const psum = new Float64Array(N);
  const dpT = new Float64Array(N);
  const dpF = new Float64Array(N);
  const last = new Int8Array(N);

  for (let S = 1; S < N; S++) {
    const low = S & -S;
    psum[S] = psum[S ^ low] + jobs[31 - Math.clz32(low)].p;
    const C = psum[S];
    let bestT = Infinity;
    let bestF = Infinity;
    let bestJ = -1;
    for (let j = 0, bit = 1; j < n; j++, bit <<= 1) {
      if (!(S & bit)) continue;
      const { d, w } = jobs[j];
      const prev = S ^ bit;
      const t = dpT[prev] + (C > d ? w * (C - d) : 0);
      const f = dpF[prev] + w * C;
      if (better(t, f, bestT, bestF)) {
        bestT = t;
        bestF = f;
        bestJ = j;
      }
    }
    dpT[S] = bestT;
    dpF[S] = bestF;
    last[S] = bestJ;
  }

  const order = [];
  for (let S = N - 1; S; S ^= 1 << last[S]) order.push(last[S]);
  order.reverse();
  return { order, tardiness: dpT[N - 1], weightedCompletion: dpF[N - 1] };
}

/** Earliest due date first; ties by weight (desc), then index. */
function eddOrder(jobs) {
  return jobs
    .map((_, i) => i)
    .sort((a, b) => jobs[a].d - jobs[b].d || jobs[b].w - jobs[a].w || a - b);
}

/** Weighted shortest processing time first (Smith's rule). */
function wsptOrder(jobs) {
  return jobs
    .map((_, i) => i)
    .sort((a, b) => jobs[b].w / jobs[b].p - jobs[a].w / jobs[a].p || a - b);
}

/**
 * Apparent Tardiness Cost: at each step pick the job with the largest
 *   (w_j / p_j) * exp(-max(0, d_j - p_j - t) / (k * pbar)).
 * Small k favours urgency (EDD-like), large k favours WSPT.
 */
function atcOrder(jobs, k) {
  const n = jobs.length;
  const pbar = jobs.reduce((s, j) => s + j.p, 0) / n || 1;
  const left = new Set(jobs.map((_, i) => i));
  const order = [];
  let t = 0;
  while (left.size) {
    let best = -1;
    let bestScore = -1;
    let bestRatio = -1;
    for (const i of left) {
      const { p, d, w } = jobs[i];
      const slack = Number.isFinite(d) ? Math.max(0, d - p - t) : Infinity;
      const ratio = w / p;
      const score = ratio * Math.exp(-slack / (k * pbar));
      if (score > bestScore || (score === bestScore && ratio > bestRatio)) {
        best = i;
        bestScore = score;
        bestRatio = ratio;
      }
    }
    left.delete(best);
    order.push(best);
    t += jobs[best].p;
  }
  return order;
}

/**
 * Insertion local search: repeatedly take one job out and put it back at the
 * position that improves the cost most, until no move helps.
 * Each pass is O(n^3); passes are capped so worst-case time stays bounded.
 */
function localSearch(jobs, start, maxPasses = 50) {
  let order = start.slice();
  let cost = evaluate(jobs, order);
  const n = order.length;
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (let i = 0; i < n; i++) {
      const job = order[i];
      const rest = order.slice(0, i).concat(order.slice(i + 1));
      let bestPos = -1;
      let bestCost = cost;
      for (let k = 0; k <= rest.length; k++) {
        if (k === i) continue; // same as the current order
        const cand = rest.slice(0, k).concat([job], rest.slice(k));
        const c = evaluate(jobs, cand);
        if (better(c.tardiness, c.weightedCompletion, bestCost.tardiness, bestCost.weightedCompletion)) {
          bestCost = c;
          bestPos = k;
        }
      }
      if (bestPos >= 0) {
        order = rest.slice(0, bestPos).concat([job], rest.slice(bestPos));
        cost = bestCost;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return { order, ...cost };
}

function solveHeuristic(jobs) {
  if (jobs.length === 0) return { order: [], ...evaluate(jobs, []) };
  const starts = [eddOrder(jobs), wsptOrder(jobs), ...[0.5, 1, 2, 4].map((k) => atcOrder(jobs, k))];
  let best = null;
  for (const s of starts) {
    const r = localSearch(jobs, s);
    if (!best || better(r.tardiness, r.weightedCompletion, best.tardiness, best.weightedCompletion)) {
      best = r;
    }
  }
  return best;
}

/**
 * Pick the solver by size.
 * @returns {{order:number[], tardiness:number, weightedCompletion:number,
 *            method:'exact'|'heuristic', optimal:boolean}}
 */
function sequence(jobs, { exactLimit = DEFAULT_EXACT_LIMIT } = {}) {
  for (const j of jobs) {
    if (!(j.p > 0) || !(j.w > 0) || Number.isNaN(j.d)) {
      throw new TypeError('every job needs p > 0, w > 0 and a numeric d');
    }
  }
  if (jobs.length <= exactLimit) return { ...solveExact(jobs), method: 'exact', optimal: true };
  return { ...solveHeuristic(jobs), method: 'heuristic', optimal: false };
}

module.exports = {
  DEFAULT_EXACT_LIMIT,
  evaluate,
  solveExact,
  solveHeuristic,
  sequence,
  eddOrder,
  wsptOrder,
  atcOrder,
  localSearch,
};
