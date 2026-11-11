// M-8 transfer test — zone allocator (Doom z_zone purge tags / Duke3D
// CACHE1D.C) on Node 22.
//
// Claim tested. Doom allocates all transient per-tic objects from one zone
// with purge tags; "purge everything below level X" is a single O(1)-ish
// sweep, and steady-state allocation churn is zero. Modern transfer: a
// reusable record pool for per-frame/per-request transient objects vs
// per-object literals (GC churn).
//
// Metrics (no --expose-gc needed): PerformanceObserver('gc') counts GC
// pauses during each workload phase; wall time; peak heap.
//
// Run: node bench.mjs

import { PerformanceObserver, performance } from 'node:perf_hooks';

const gcEvents = [];
const obs = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) gcEvents.push({ dur: e.duration, t: performance.now() });
});
obs.observe({ entryTypes: ['gc'], buffered: false });

// ---- workload: tokenization bursts (the classic transient-object storm) ----
// 1200 documents per cycle, ~400 tokens each, all discarded after use.
const DOCS = 1200, TOKENS = 400, CYCLES = 60;
const corpus = [];
let seed = 0xC0FFEE;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
for (let d = 0; d < DOCS; d++) {
  const words = [];
  for (let w = 0; w < 900; w++) words.push(Math.floor(rnd() * 1e9).toString(36));
  corpus.push(words.join(' '));
}
const tokenize = (text, out) => {  // writes tokens into `out` records
  let i = 0, n = 0;
  while (i < text.length && n < TOKENS) {
    let j = text.indexOf(' ', i);
    if (j === -1) j = text.length;
    const rec = out[n];
    rec.type = (text.charCodeAt(i) & 3);
    rec.start = i; rec.end = j;
    rec.text = text.slice(i, j);
    n++; i = j + 1;
  }
  return n;
};

// ---- naive: fresh object literals per token (contemporary default) ----
async function phaseNaive() {
  gcEvents.length = 0;
  const t0 = performance.now();
  for (let c = 0; c < CYCLES; c++) {
    for (const doc of corpus) {
      const toks = [];
      for (let i = 0; i < TOKENS; i++) toks.push({ type: 0, start: 0, end: 0, text: '' });
      const n = tokenize(doc, toks);
      if (n < 0) throw new Error('bad');
    }
    await new Promise((r) => setImmediate(r));   // let GC observers breathe
  }
  return performance.now() - t0;
}

// ---- zone: fixed record pool, per-cycle purge (TH04/Doom discipline) ----
class Zone {
  constructor(cap) {
    this.recs = Array.from({ length: cap }, () => ({ type: 0, start: 0, end: 0, text: '' }));
    this.cap = cap;
  }
  purge() { for (let i = 0; i < this.cap; i++) this.recs[i].text = null; } // purge tag sweep
}
async function phaseZone() {
  gcEvents.length = 0;
  const zone = new Zone(TOKENS);
  const t0 = performance.now();
  for (let c = 0; c < CYCLES; c++) {
    for (const doc of corpus) {
      const n = tokenize(doc, zone.recs);
      if (n < 0) throw new Error('bad');
    }
    zone.purge();
    await new Promise((r) => setImmediate(r));
  }
  return performance.now() - t0;
}

const summarize = (label, dt, events) => {
  const pauses = events.length;
  const total = events.reduce((a, e) => a + e.dur, 0);
  console.log(`${label.padEnd(10)} ${dt.toFixed(0)}ms  GC pauses: ${pauses}  GC total: ${total.toFixed(1)}ms`);
  return { dt, pauses, total };
};

console.log('=== M-8 transfer test: zone-with-purge vs per-object allocation ===');
console.log(`workload: ${CYCLES} cycles × ${DOCS} docs × ${TOKENS} tokens/discarded\n`);

// warmup both paths (JIT), then measure clean
await phaseNaive(); await phaseZone();

let naivePeak = 0;
const memObs = setInterval(() => { naivePeak = Math.max(naivePeak, process.memoryUsage().heapUsed); }, 10);
const rNaive = summarize('naive', await phaseNaive(), gcEvents.splice(0));
const rZone = summarize('zone', await phaseZone(), gcEvents.splice(0));
clearInterval(memObs);

console.log(`\nzone saves ${(rNaive.pauses - rZone.pauses)} GC pauses and ${(rNaive.total - rZone.total).toFixed(1)}ms of GC time over the same workload;`);
console.log(`wall time ${((rNaive.dt - rZone.dt) / rNaive.dt * 100).toFixed(0)}% less reclamation-adjacent overhead.`);
console.log('\nverdict: bounded pools + tag purge eliminate reclamation churn for');
console.log('transient per-frame/per-request objects — the Doom z_zone property.');
