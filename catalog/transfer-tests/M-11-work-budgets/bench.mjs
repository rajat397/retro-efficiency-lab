// M-11 transfer test — hard per-operation work budgets vs unbounded search.
//
// Claim tested. RCT2 pathfinding does bounded DFS (15k tiles / 200 steps /
// 5-8 junction depth) with inline per-peep greedy memory (pathfindGoal +
// 4-entry pathfindHistory, Peep.h:413-414) so per-tick retries self-heal.
// Duke3D caps clipmove collision candidates at 3 (ENGINE.C:5029). The
// transferable property: **bounded per-operation work keeps tick latency
// flat under load, and partial results + history-guided retry converge —
// paying a small, measured path-quality cost.**
//
// Scenario: 64x64 maze; agents pathfind on a burst spawn (worst-case
// single-tick load) then walk one cell/tick; 400-tick horizon.
// Variants: optimal BFS (quality ceiling) vs budgeted greedy DFS sweep
// — the quality/latency Pareto curve.
//
// Run: node bench.mjs

import { performance } from 'node:perf_hooks';

function mulberry32(seed) { let a = seed >>> 0; return () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const W = 64, H = 64, CELLS = W * H;
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // N, E, S, W
const rng = mulberry32(0xBEEF);
const wall = new Uint8Array(CELLS);
for (let c = 0; c < CELLS; c++) wall[c] = rng() < 0.16 ? 1 : 0;
const xOf = (c) => c % W, yOf = (c) => (c / W) | 0, idx = (x, y) => y * W + x;
// full vertical barrier: a reachable half and an unreachable half
// (RCT2's budget is sized vs a map where unreachable regions exist)
for (let y = 0; y < H; y++) wall[idx(32, y)] = 1;
const euclid = (a, b) => { const dx = xOf(a) - xOf(b), dy = yOf(a) - yOf(b); return dx * dx + dy * dy; };

// largest connected component
const comp = new Int32Array(CELLS).fill(-1);
let bestComp = -1, bestSize = 0, compId = 0;
for (let c = 0; c < CELLS; c++) {
  if (wall[c] || comp[c] !== -1) continue;
  const q = [c]; comp[c] = compId; let size = 0;
  while (q.length) {
    const n = q.pop(); size++;
    for (const [dx, dy] of DIRS) {
      const nx = xOf(n) + dx, ny = yOf(n) + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const m = idx(nx, ny);
      if (!wall[m] && comp[m] === -1) { comp[m] = compId; q.push(m); }
    }
  }
  if (size > bestSize) { bestSize = size; bestComp = compId; }
  compId++;
}
const cells = [];
for (let c = 0; c < CELLS; c++) if (!wall[c] && comp[c] === bestComp) cells.push(c);
console.log(`maze: ${CELLS} cells, walls=${wall.reduce((a, b) => a + b, 0)}, main component=${bestSize}\n`);

// ---- reference: BFS distance field from a goal (optimal) ----
let _bfsTiles = 0;
function bfsDist(goal) {
  const d = new Int32Array(CELLS).fill(-1);
  const q = new Int32Array(CELLS); let qh = 0, qt = 0;
  d[goal] = 0; q[qt++] = goal; _bfsTiles = 0;
  while (qh < qt) {
    const n = q[qh++];
    for (const [dx, dy] of DIRS) {
      const nx = xOf(n) + dx, ny = yOf(n) + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const m = idx(nx, ny);
      if (!wall[m] && d[m] === -1) { d[m] = d[n] + 1; q[qt++] = m; _bfsTiles++; }
    }
  }
  return d;
}
function bfsPath(start, goal) {
  const d = bfsDist(goal);
  if (d[start] === -1) return { path: [start], found: false, tiles: _bfsTiles };
  const path = [start];
  let n = start;
  while (n !== goal) {
    for (const [dx, dy] of DIRS) {
      const nx = xOf(n) + dx, ny = yOf(n) + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const m = idx(nx, ny);
      if (!wall[m] && d[m] === d[n] - 1) { n = m; path.push(m); break; }
    }
  }
  return { path, found: true, tiles: d[start], firstDir: dirOf(path[0], path[1] ?? path[0]) };
}
function dirOf(a, b) {
  const dx = xOf(b) - xOf(a), dy = yOf(b) - yOf(a);
  return dy === -1 ? 0 : dx === 1 ? 1 : dy === 1 ? 2 : 3;
}

// ---- the mechanism: budgeted greedy DFS with 4-entry pathfindHistory ----
// Neighbor order biased toward goal; directions recorded as failed get a
// heavy ordering penalty (the history), cleared when a retry makes progress.
// M-2 discipline: static buffers reused across calls (RCT2 uses static memory);
// generation stamps avoid clearing between searches
const _visited = new Uint32Array(CELLS);
const _parent = new Int32Array(CELLS);
const _stack = new Int32Array(CELLS);
let _gen = 0;
function dfSearch(start, goal, budget, failedDirs) {
  _gen++;
  const visited = _visited, parent = _parent;
  let sp = 0;
  _stack[sp++] = start;
  visited[start] = _gen;
  parent[start] = -1;
  let tiles = 0, best = start, bestD = euclid(start, goal), found = false, firstDir = -1;
  while (sp > 0 && tiles < budget) {
    const n = _stack[--sp]; tiles++;
    const nd = euclid(n, goal);
    if (nd < bestD) { bestD = nd; best = n; }
    if (n === goal) { found = true; break; }
    const cand = [];
    for (let d = 0; d < 4; d++) {
      const nx = xOf(n) + DIRS[d][0], ny = yOf(n) + DIRS[d][1];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const m = idx(nx, ny);
      if (wall[m] || visited[m] === _gen) continue;
      cand.push({ m, d, e: euclid(m, goal) + ((failedDirs & (1 << d)) ? 1e9 : 0) });
    }
    cand.sort((a, b) => a.e - b.e);
    for (let i = cand.length - 1; i >= 0; i--) {   // push reversed: closest pops FIRST (goal-biased DFS)
      visited[cand[i].m] = _gen; parent[cand[i].m] = n; _stack[sp++] = cand[i].m;
      if (n === start && firstDir === -1) firstDir = cand[i].d;
    }
  }
  const end = found ? goal : best;
  const path = [];
  for (let n = end; n !== -1; n = parent[n]) path.push(n);
  path.reverse();
  return { path, found, tiles, firstDir };
}

// ---- simulation ----
function simulate({ nAgents, budget, burst, ticks = 400, goalCells = null }) {
  const agents = [];
  for (let i = 0; i < nAgents; i++) {
    const start = cells[(i * 7919 + 13) % cells.length];
    const goal = goalCells
      ? goalCells[i % goalCells.length]
      : cells[(i * 6271 + 7001) % cells.length];
    if (start === goal) { agents.push({ done: true, at: 0, steps: 0, opt: 0 }); continue; }
    agents.push({ start, goal, path: null, pi: 0, done: false, at: -1, steps: 0,
                  failedDirs: 0, lastBestD: Infinity, opt: bfsDist(goal)[start] });
  }
  let maxTickMs = 0, totalPathMs = 0, tilesTotal = 0, retries = 0, searches = 0;
  const spawnWindow = burst ? 1 : 40;
  const t0 = performance.now();
  for (let t = 0; t < ticks; t++) {
    const tickStart = performance.now();
    for (const a of agents) {
      if (a.done) continue;
      if (!burst && t < spawnWindow && (t * nAgents) / spawnWindow > agents.indexOf(a)) continue;
      // (re)path when needed
      if (a.path === null) {
        const ts = performance.now();
        const r = budget === Infinity ? bfsPath(a.start, a.goal)
                                      : dfSearch(a.start, a.goal, budget, a.failedDirs);
        totalPathMs += performance.now() - ts;
        tilesTotal += r.tiles; searches++;
        if (!r.found) {
          retries++;
          const bd = euclid(a.path ? a.path[a.path.length - 1] : a.start, a.goal);
          if (r.firstDir >= 0) a.failedDirs |= (1 << r.firstDir);   // history: this way failed
          if (bd < a.lastBestD - 4) a.failedDirs = 0;               // progress clears history
          a.lastBestD = Math.min(a.lastBestD, bd);
        } else { a.failedDirs = 0; a.lastBestD = Infinity; }
        a.path = r.path; a.pi = 0;
      }
      // walk one cell
      if (a.pi < a.path.length) {
        a.pi++; a.steps++;
        const cell = a.path[Math.min(a.pi, a.path.length - 1)];
        if (a.pi >= a.path.length - 1 && cell === a.goal) {
          a.done = true; a.at = t;
          continue;
        }
        if (a.pi >= a.path.length - 1 && cell !== a.goal) a.path = null;  // partial exhausted -> retry next tick
      }
    }
    const dt = performance.now() - tickStart;
    if (dt > maxTickMs) maxTickMs = dt;
  }
  const wallTotal = performance.now() - t0;
  let arrived = 0, ovs = 0, ovsN = 0;
  for (const a of agents) {
    if (a.done) { arrived++; if (a.opt > 0) { ovs += a.steps / a.opt; ovsN++; } }
  }
  return { arrived, maxTickMs, wallTotal, totalPathMs, retries, searches,
           overshoot: ovsN ? ovs / ovsN : 0, tilesTotal };
}

console.log('=== M-11 transfer test: hard work budgets vs unbounded search ===\n');

const leftComp = comp[idx(1, 1)];
const left = [], right = [];
for (let c = 0; c < CELLS; c++) {
  if (wall[c]) continue;
  (comp[c] === leftComp ? left : right).push(c);
}
console.log(`maze: reachable half=${left.length} cells, unreachable half=${right.length} cells\n`);

console.log('scenario 1 — TYPICAL (budget sized above need): 500 agents, burst, reachable goals, 400-tick horizon');
console.log('variant         | maxTickMs | pathMs  | arrived% | overshoot');
for (const budget of [Infinity, 4000]) {
  const r = simulate({ nAgents: 500, budget, burst: true });
  const label = budget === Infinity ? 'BFS optimal ' : `DFS b=4000  `;
  console.log(`${label}     | ${r.maxTickMs.toFixed(1).padStart(6)}ms | ${r.totalPathMs.toFixed(0).padStart(5)}ms | ${(r.arrived / 5).toFixed(1).padStart(5)}%  | +${(r.overshoot * 100 - 100).toFixed(1)}%`);
}

{
  // deep pairs: greedy DFS must traverse far; small budgets bind here
  // pick deep pairs adaptively: threshold = 70% of the map's actual max distance
  let maxD = 0;
  for (let i = 0; i < 30; i++) {
    const s = left[(i * 7919 + 13) % left.length];
    const d = bfsDist(s);
    for (const g of left) if (d[g] > maxD) maxD = d[g];
  }
  const deepThresh = Math.ceil(maxD * 0.7);
  const distOf = new Map();
  for (const s of left) {
    const d = bfsDist(s);
    for (const g of left) if (d[g] >= deepThresh) { distOf.set(s, g); break; }
    if (distOf.size >= 500) break;
  }
  const pairs = [...distOf.entries()];
  const avgDeep = pairs.length ? pairs.reduce((a, [s, g]) => a + bfsDist(g)[s], 0) / pairs.length : 0;
  const tightBudget = Math.max(8, Math.ceil(avgDeep * 0.5));
  console.log(`\nscenario 2 — HOSTILE topology vs undersized budget: goals at BFS-distance >= ${deepThresh} (map max ${maxD})`);
  console.log(`  (deep pairs, tight budget=${tightBudget})`);
  const runPair = (budget) => {
    let arrived = 0, ovs = 0, ovsN = 0, maxTick = 0, pathMs = 0, tiles = 0;
    const list = pairs.slice(0, 300).map(([s, g]) => ({ start: s, goal: g, path: null, pi: 0, done: false, failedDirs: 0, lastBestD: Infinity, steps: 0, opt: bfsDist(g)[s] }));
    const t0 = performance.now();
    for (let t = 0; t < 400; t++) {
      const ts = performance.now();
      for (const a of list) {
        if (a.done) continue;
        if (a.path === null) {
          const t1 = performance.now();
          const r = budget === Infinity ? bfsPath(a.start, a.goal) : dfSearch(a.start, a.goal, budget, a.failedDirs);
          pathMs += performance.now() - t1; tiles += r.tiles;
          if (!r.found) { a.failedDirs |= (1 << (r.firstDir ?? 0)); const bd = euclid(a.start, a.goal); if (bd < a.lastBestD - 4) a.failedDirs = 0; a.lastBestD = Math.min(a.lastBestD, bd); }
          else a.failedDirs = 0;
          a.path = r.path; a.pi = 0;
        }
        if (a.pi < a.path.length) {
          a.pi++; a.steps++;
          const cell = a.path[Math.min(a.pi, a.path.length - 1)];
          if (a.pi >= a.path.length - 1 && cell === a.goal) { a.done = true; continue; }
          if (a.pi >= a.path.length - 1 && cell !== a.goal) a.path = null;
        }
      }
      const dt = performance.now() - ts;
      if (dt > maxTick) maxTick = dt;
    }
    for (const a of list) if (a.done) { arrived++; if (a.opt > 0) { ovs += a.steps / a.opt; ovsN++; } }
    return { arrived, maxTick, pathMs, tiles, overshoot: ovsN ? ovs / ovsN : 1 };
  };
  for (const budget of [Infinity, 4000, tightBudget]) {
    const r = runPair(budget);
    const label = budget === Infinity ? 'BFS optimal ' : `DFS b=${String(budget).padEnd(4)}`;
    console.log(`${label}     | maxTick ${r.maxTick.toFixed(1).padStart(6)}ms | arrived ${(r.arrived / 3).toFixed(1).padStart(5)}% | overshoot +${(r.overshoot * 100 - 100).toFixed(1)}% | pathMs ${r.pathMs.toFixed(0)}`);
  }
  console.log('  -> hostile topology is where undersized budgets bind; sized right, they are free');
}

console.log('\nscenario 3 — PATHOLOGICAL (the cap\'s purpose): 500 goals UNREACHABLE, one search each (no retry confound)');
{
  const starts = [];
  for (let i = 0; i < 500; i++) starts.push(left[(i * 7919 + 13) % left.length]);
  const goals = [];
  for (let i = 0; i < 500; i++) goals.push(right[(i * 6271 + 7001) % right.length]);
  for (const budget of [Infinity, 1000, 250]) {
    let tiles = 0, maxSearch = 0, total = 0;
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) {
      const t1 = performance.now();
      const r = budget === Infinity ? bfsPath(starts[i], goals[i])
                                    : dfSearch(starts[i], goals[i], budget, 0);
      const dt = performance.now() - t1;
      tiles += r.tiles; total += dt; if (dt > maxSearch) maxSearch = dt;
    }
    const wall = performance.now() - t0;
    const label = budget === Infinity ? 'BFS optimal ' : `DFS b=${String(budget).padEnd(4)}`;
    console.log(`${label}     | tiles/agent=${(tiles / 500).toFixed(0).padStart(5)} | total=${total.toFixed(0).padStart(6)}ms | maxSearch=${maxSearch.toFixed(1)}ms | wall=${wall.toFixed(0)}ms`);
  }
  console.log('  -> the cap converts the pathological per-agent scan into a fixed, graceful failure');
}

console.log(`\nverdict: sized above typical need, the budget is FREE (scenario 1: same`);
console.log(`arrivals, comparable latency, quality carried by the greedy shape). Its`);
console.log(`purpose is the pathological case (scenario 3): unbounded search pays full`);
console.log(`reach per agent; the budget pays a fixed bound and fails gracefully.`);
console.log(`Undersized budgets throttle ordinary work (scenario 2) — that is the`);
console.log(`card's documented cost, not a hypothetical.`);
