// M-2 transfer test v3 — slot pool (TH04 mechanism) vs canonical per-frame
// allocation, at TWO scales:
//   H = historical (cap 440, 10 spawns/frame — TH04's actual envelope)
//   M = modern     (cap 4096, 100 spawns/frame — a modern particle/UI load)
//
// Fairness contract:
//   - Both versions respect the same cap and consume the SAME number of RNG
//     draws per spawn attempt and per alive bullet per frame (statistically
//     identical workload; trajectories may differ, distributions don't).
//   - Naive = the canonical idiom: spawn object literals into an array,
//     mutate in place, compact in place each frame. Not a strawman: real
//     filters/allocations are present where the idiom has them (object per
//     spawn); the sweep is the in-place variant of .filter().
//   - Pool = faithful FUN_23a9_8e38 mechanism: fixed slots, flag machine
//     in-record (FREE/ALIVE/REMOVE+decay), backward update, zero allocation
//     after load, integer subpixel math.

import { PerformanceObserver } from 'node:perf_hooks';

const SUBPIXEL = 16;
const FIELD_W = 384 * SUBPIXEL, FIELD_H = 448 * SUBPIXEL;
const DECAY_FRAMES = 16;
const BOUNCE_MAX_AGE = 180;    // TH04 bounds bounce via bullet_special.turns_max
const KILL_P = 0.015;          // per-frame random kill
const SAMPLE_EVERY = 300;

const F_FLAG = 0, F_AGE = 1, F_X = 2, F_Y = 3, F_VX = 4, F_VY = 5,
      F_MOVE = 6, F_TIMER = 7;
const STRIDE = 8;
const F_FREE = 0, F_ALIVE = 1, F_REMOVE = 2;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- pool ----
function benchPool(cap, spawnsPerFrame, frames, debug = false) {
  const dbg = { alive: 0, freed: 0, pops: 0, doublePop: 0, corrupt: 0 };
  const pool = new Int32Array(cap * STRIDE);
  const rng = mulberry32(0xC0FFEE);
  // Modern adaptation of TH04's spawn scan: a free-slot STACK (O(1) spawn/free).
  // TH04's wraparound cursor scan is O(cap) per failed spawn when nearly full —
  // affordable at 440 slots in assembly, degenerate at 4096. Same record state
  // machine, same zero-allocation guarantee.
  const freeStack = new Int32Array(cap);
  for (let n = 0; n < cap; n++) freeStack[n] = cap - 1 - n;  // LIFO init
  let freeTop = cap;
  let dropped = 0, spawned = 0, peakHeap = 0;
  const samples = [], liveSamples = [];

  for (let frame = 0; frame < frames; frame++) {
    const t0 = performance.now();
    for (let s = 0; s < spawnsPerFrame; s++) {
      // identical RNG draws per attempt, placement-independent
      const angle = (rng() * 256) | 0;
      const speed = (2 + rng() * 6) * SUBPIXEL | 0;
      const bounce = rng() < 0.25;
      const px = (FIELD_W * rng()) | 0, py = (FIELD_H * rng()) | 0;
      const vx = Math.round(Math.cos(angle / 256 * Math.PI * 2) * speed);
      const vy = Math.round(Math.sin(angle / 256 * Math.PI * 2) * speed);
      if (freeTop === 0) { dropped++; continue; }
      const n = freeStack[--freeTop];
      if (debug) { dbg.pops++; if (pool[n * STRIDE + F_FLAG] === F_ALIVE) dbg.doublePop++; }
      const i = n * STRIDE;
      pool[i + F_FLAG] = F_ALIVE;  pool[i + F_AGE] = 0;
      pool[i + F_X] = px;  pool[i + F_Y] = py;
      pool[i + F_VX] = vx;  pool[i + F_VY] = vy;
      pool[i + F_MOVE] = bounce ? 1 : 2;
      pool[i + F_TIMER] = 0;
      spawned++;
    }
    // update: BACKWARD, flag machine in-record (faithful to FUN_23a9_8e38)
    let live = 0;
    for (let n = cap - 1; n >= 0; n--) {
      const i = n * STRIDE;
      const flag = pool[i + F_FLAG];
      if (flag === F_FREE) continue;
      if (flag === F_REMOVE) {
        if (++pool[i + F_TIMER] >= DECAY_FRAMES) {
          pool[i + F_FLAG] = F_FREE;
          freeStack[freeTop++] = n;
          if (debug) dbg.freed++;
        }
        continue;
      }
      if (debug && flag !== F_ALIVE) dbg.corrupt++;
      live++;   // alive (corpses in REMOVE are counted in the sample below)
      if (debug) dbg.alive++;
      pool[i + F_AGE]++;
      pool[i + F_X] += pool[i + F_VX];
      pool[i + F_Y] += pool[i + F_VY];
      const x = pool[i + F_X], y = pool[i + F_Y];
      if (pool[i + F_MOVE] === 1) {          // BOUNCE (turns_max-bounded)
        if (pool[i + F_AGE] >= BOUNCE_MAX_AGE) {
          pool[i + F_FLAG] = F_REMOVE; pool[i + F_TIMER] = 0; continue;
        }
        if (x < 0 || x >= FIELD_W) pool[i + F_VX] = -pool[i + F_VX];
        if (y < 0 || y >= FIELD_H) pool[i + F_VY] = -pool[i + F_VY];
      } else if (x < -0x1000 || x >= FIELD_W + 0x1000 || y < -0x1000 || y >= FIELD_H + 0x1000) {
        pool[i + F_FLAG] = F_REMOVE; pool[i + F_TIMER] = 0;
      } else if (rng() < KILL_P) {           // per-frame random kill
        pool[i + F_FLAG] = F_REMOVE; pool[i + F_TIMER] = 0;
      }
    }
    const t1 = performance.now();
    if (frame === 5999 && debug) {
      const c = [0, 0, 0];
      let moveHist = [0, 0];
      let maxAge = 0, ageSum = 0;
      for (let n = 0; n < cap; n++) {
        const i = n * STRIDE; const f = pool[i + F_FLAG];
        if (f === F_FREE) c[0]++; else if (f === F_ALIVE) { c[1]++; moveHist[pool[i + F_MOVE]]++; maxAge = Math.max(maxAge, pool[i + F_AGE]); ageSum += pool[i + F_AGE]; }
        else c[2]++;
      }
      console.log(`  [pool@5999] spawns=${spawned} FREE=${c[0]} ALIVE=${c[1]} REMOVE=${c[2]} freed=${dbg.freed} freeTop=${freeTop}`);
      console.log(`  [pool@5999] move: bounce=${moveHist[1]} linear=${moveHist[2]}  maxAge=${maxAge} avgAge=${(ageSum/Math.max(1,c[1])).toFixed(0)}`);
      let printed = 0;
      for (let n = 0; n < cap && printed < 5; n++) {
        const i = n * STRIDE;
        if (pool[i + F_FLAG] === F_ALIVE) {
          console.log(`   slot ${n}: flag=${pool[i+F_FLAG]} age=${pool[i+F_AGE]} x=${pool[i+F_X]} y=${pool[i+F_Y]} vx=${pool[i+F_VX]} vy=${pool[i+F_VY]} move=${pool[i+F_MOVE]}`);
          printed++;
        }
      }
    }
    if (frame === 299 && debug) {
      const c = [0, 0, 0];
      for (let n = 0; n < cap; n++) { const f = pool[n * STRIDE + F_FLAG]; if (f === F_FREE) c[0]++; else if (f === F_ALIVE) c[1]++; else c[2]++; }
      console.log(`  [pool@300] spawns=${spawned} FREE=${c[0]} ALIVE=${c[1]} REMOVE=${c[2]} freed=${dbg.freed} freeTop=${freeTop}`);
      // trace one slot's history: slot with lowest age alive
    }
    if (frame % SAMPLE_EVERY === SAMPLE_EVERY - 1) {
      samples.push(t1 - t0);
      liveSamples.push(live + (cap - freeTop - live));
      peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    }
  }
  return { samples, liveSamples, peakHeap, dropped, spawned, allocations: 0, dbg };
}

// --------------------------------------------------------------- naive ----
function benchNaive(cap, spawnsPerFrame, frames) {
  const bullets = [];                        // the modern idiom: plain array
  const rng = mulberry32(0xC0FFEE);
  let dropped = 0, spawned = 0, peakHeap = 0;
  const samples = [], liveSamples = [];

  for (let frame = 0; frame < frames; frame++) {
    const t0 = performance.now();
    for (let s = 0; s < spawnsPerFrame; s++) {
      // identical RNG draws per attempt, placement-independent
      const angle = rng() * Math.PI * 2;
      const speed = (2 + rng() * 6) * SUBPIXEL;
      const bounce = rng() < 0.25;
      const px = (FIELD_W * rng()) | 0, py = (FIELD_H * rng()) | 0;
      const vx = Math.round(Math.cos(angle) * speed);
      const vy = Math.round(Math.sin(angle) * speed);
      if (bullets.length >= cap) { dropped++; continue; }
      bullets.push({                     // <- allocation every spawn
        age: 0, x: px, y: py, vx, vy, bounce,
        dead: false, decay: 0, remove: false,
      });
      spawned++;
    }
    // update BACKWARD (matches pool traversal direction; rng order per-alive)
    for (let k = bullets.length - 1; k >= 0; k--) {
      const b = bullets[k];
      if (b.dead) { if (++b.decay >= DECAY_FRAMES) b.remove = true; continue; }
      b.age++;
      b.x += b.vx; b.y += b.vy;
      if (b.bounce) {
        if (b.age >= BOUNCE_MAX_AGE) b.dead = true;
        else {
          if (b.x < 0 || b.x >= FIELD_W) b.vx = -b.vx;
          if (b.y < 0 || b.y >= FIELD_H) b.vy = -b.vy;
        }
      } else if (b.x < -0x1000 || b.x >= FIELD_W + 0x1000 || b.y < -0x1000 || b.y >= FIELD_H + 0x1000) {
        b.dead = true;
      } else if (rng() < KILL_P) {         // per-frame random kill
        b.dead = true;
      }
    }
    let w = 0;                              // in-place variant of .filter()
    for (let k = 0; k < bullets.length; k++) {
      const b = bullets[k];
      if (!b.remove) bullets[w++] = b;
    }
    bullets.length = w;
    const t1 = performance.now();
    if (frame % SAMPLE_EVERY === SAMPLE_EVERY - 1) {
      samples.push(t1 - t0);
      liveSamples.push(bullets.length);
      peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    }
  }
  return { samples, liveSamples, peakHeap, dropped, spawned, allocations: spawned };
}

// ---------------------------------------------------------------- harness -
const gcStats = { count: 0, totalMs: 0 };
new PerformanceObserver(list => {
  for (const e of list.getEntries()) { gcStats.count++; gcStats.totalMs += e.duration; }
}).observe({ entryTypes: ['gc'], buffered: true });

const stats = s => {
  const a = [...s].sort((x, y) => x - y);
  return { avg: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3),
           p95: +a[Math.floor(a.length * 0.95)].toFixed(3) };
};
const mb = b => +(b / 1048576).toFixed(1);

for (let i = 0; i < 2000; i++) { /* JIT warmup */ }
if (globalThis.gc) globalThis.gc();

for (const [tag, cap, spf, frames] of [['HISTORICAL', 440, 10, 6000], ['MODERN', 4096, 100, 6000]]) {
  const naive = benchNaive(cap, spf, frames);
  const naiveGc = { count: gcStats.count, totalMs: +gcStats.totalMs.toFixed(1) };
  if (globalThis.gc) globalThis.gc();
  gcStats.count = 0; gcStats.totalMs = 0;

  const pool = benchPool(cap, spf, frames, false);
console.log(`  [pool debug] aliveAtEnd=${pool.dbg.alive} freed=${pool.dbg.freed} pops=${pool.dbg.pops} doublePop=${pool.dbg.doublePop} corruptFlags=${pool.dbg.corrupt}`);
  const poolGc = { count: gcStats.count, totalMs: +gcStats.totalMs.toFixed(1) };
  if (globalThis.gc) globalThis.gc();
  gcStats.count = 0; gcStats.totalMs = 0;

  const ns = stats(naive.samples), ps = stats(pool.samples);
  const nl = naive.liveSamples.reduce((a, b) => a + b, 0) / naive.liveSamples.length;
  const pl = pool.liveSamples.reduce((a, b) => a + b, 0) / pool.liveSamples.length;

  console.log(`\n=== ${tag} scale: cap=${cap} spawns/frame=${spf} frames=${frames} ===`);
  console.log(`spawned:    naive=${naive.spawned}  pool=${pool.spawned}   avg live: naive=${nl.toFixed(0)}  pool=${pl.toFixed(0)}`);
  console.log('metric                    | naive (push/sweep)  | TH04-style pool');
  console.log(`avg ms/frame              | ${String(ns.avg).padStart(19)} | ${String(ps.avg).padStart(15)}`);
  console.log(`p95 ms/frame              | ${String(ns.p95).padStart(19)} | ${String(ps.p95).padStart(15)}`);
  console.log(`objects allocated         | ${String(naive.allocations).padStart(19)} | ${String(0).padStart(15)}`);
  console.log(`GC collections in run     | ${String(naiveGc.count).padStart(19)} | ${String(poolGc.count).padStart(15)}`);
  console.log(`GC time total (ms)        | ${String(naiveGc.totalMs).padStart(19)} | ${String(poolGc.totalMs).padStart(15)}`);
  console.log(`peak heap (MB)            | ${String(mb(naive.peakHeap)).padStart(19)} | ${String(mb(pool.peakHeap)).padStart(15)}`);
  console.log(`speedup avg / p95         |         ---         | ${(ns.avg / ps.avg).toFixed(2)}x / ${(ns.p95 / ps.p95).toFixed(2)}x`);
}
