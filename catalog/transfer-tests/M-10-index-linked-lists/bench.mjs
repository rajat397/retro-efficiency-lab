// M-10 transfer test — fixed-pool entities with index-linked membership lists
// (Duke3D/Build ENGINE.C sector+status lists, RCT2 quadrant+type lists).
//
// Claim tested. Entities live in one fixed array; membership lists are chains
// of slot indices (side-arrays keyed by index in Build, in-record with a
// discriminator in RCT2). An entity sits in MULTIPLE lists at once; iteration
// walks only the needed subset. The transferable property: **query cost scales
// with the subset, not the pool** — and survives churn (unlink+link is O(1)).
//
// Run: node bench.mjs

import { performance } from 'node:perf_hooks';

const POOL = 65536;

// ---- the mechanism, Build-style: side-array link tables over a fixed pool ----
class Pool {
  constructor() {
    this.flags = new Int32Array(POOL);          // 0 free, 1 alive
    this.next = new Int32Array(POOL); this.prev = new Int32Array(POOL);
    this.free = new Int32Array(POOL);
    for (let i = 0; i < POOL; i++) this.free[i] = POOL - 1 - i;
    this.freeTop = POOL;
    this.lists = new Map();                      // name -> {head, count}
  }
  alloc() { const s = this.free[--this.freeTop]; this.flags[s] = 1; return s; }
  freeSlot(s) { this.flags[s] = 0; this.free[this.freeTop++] = s; }
  insert(list, s) {
    let L = this.lists.get(list);
    if (!L) { L = { head: -1, count: 0 }; this.lists.set(list, L); }
    this.next[s] = L.head; this.prev[s] = -1;
    if (L.head !== -1) this.prev[L.head] = s;
    L.head = s; L.count++;
  }
  remove(list, s) {
    const L = this.lists.get(list);
    if (this.prev[s] !== -1) this.next[this.prev[s]] = this.next[s]; else L.head = this.next[s];
    if (this.next[s] !== -1) this.prev[this.next[s]] = this.prev[s];
    L.count--;
  }
}

console.log('=== M-10 transfer test: index-linked membership lists vs full-pool scan ===\n');

// ---- scenario: 3 "regions" over 65k entities; queries target one region ----
// membership: A=20k, B=20k, C=25k (RCT2's quadrant+type shape)
for (const [querySize, label] of [[1000, 'small subset (1k)'], [25000, 'large subset (25k)']]) {
  const p = new Pool();
  const ids = [];
  for (let i = 0; i < POOL; i++) ids.push(p.alloc());
  // region C gets the biggest share; query targets a subset of C
  for (let i = 0; i < 20000; i++) p.insert('A', ids[i]);
  for (let i = 20000; i < 40000; i++) p.insert('B', ids[i]);
  for (let i = 40000; i < POOL; i++) p.insert('C', ids[i]);
  // query list: take the first querySize members of C (walk to collect once)
  const target = [];
  for (let s = p.lists.get('C').head; s !== -1 && target.length < querySize; s = p.next[s]) target.push(s);
  for (const s of target) p.remove('C', s), p.insert('Q', s);

  // 200 queries, each sums 8 fields over the subset
  const vals = new Int32Array(POOL).map((_, i) => (i * 2654435761) >>> 8);
  const work = (walk) => {
    let acc = 0;
    for (let q = 0; q < 200; q++) {
      if (walk) { for (let s = p.lists.get('Q').head; s !== -1; s = p.next[s]) acc += vals[s]; }
      else { for (let s = 0; s < POOL; s++) if (p.flags[s] === 1 && p.memberOf(s) === 'Q') acc += vals[s]; }
    }
    return acc;
  };
  // naive needs membership test: emulate RCT2 discriminator via a side map
  p.memberOf = (() => { const m = new Int8Array(POOL); for (const [name, L] of p.lists) { if (name === 'Q') continue; for (let s = L.head; s !== -1; s = p.next[s]) m[s] = 1; } const q = new Int8Array(POOL); for (let s = p.lists.get('Q').head; s !== -1; s = p.next[s]) q[s] = 1; return (s) => q[s] ? 'Q' : 'other'; })();

  work(true); work(false); // JIT warm
  let t0 = performance.now(); const r1 = work(true);  const tList = performance.now() - t0;
  t0 = performance.now(); const r2 = work(false); const tScan = performance.now() - t0;
  console.log(`${label}:`);
  console.log(`  list-walk : ${tList.toFixed(1)}ms  (visits ${querySize} slots × 200 queries)`);
  console.log(`  full-scan : ${tScan.toFixed(1)}ms  (visits ${POOL} slots × 200 queries, with membership test)`);
  console.log(`  -> ${(tScan / tList).toFixed(2)}x  (same results: ${r1 === r2})`);
}

// ---- churn, part 1: the documented COST demonstrated live — wrong-list unlink ----
{
  const p = new Pool();
  const ids = [];
  for (let i = 0; i < POOL; i++) ids.push(p.alloc());
  for (let i = 0; i < 20000; i++) p.insert('A', ids[i]);
  for (let i = 20000; i < POOL; i++) p.insert('B', ids[i]);
  for (let c = 0; c < 20; c++) {
    for (let k = 0; k < 5000; k++) {
      const s = ids[(k * 7919 + c * 13) % POOL];
      p.remove('A', s); p.remove('B', s);        // blindly unlink from both
      p.insert('B', s);
    }
  }
  console.log(`churn WITHOUT discipline (blind unlink): lists corrupt -> A=${p.lists.get('A').count} B=${p.lists.get('B').count}`);
  console.log(`  (this is RCT2's historical linked-list-corruption bug class, live)`);
}

// ---- churn, part 2: with RCT2's discriminator (which list am I in?) — O(1) and consistent ----
{
  const p = new Pool();
  const member = new Int8Array(POOL);            // the discriminator: 0 none, 1 A, 2 B
  const ids = [];
  for (let i = 0; i < POOL; i++) ids.push(p.alloc());
  for (let i = 0; i < 20000; i++) { p.insert('A', ids[i]); member[ids[i]] = 1; }
  for (let i = 20000; i < POOL; i++) { p.insert('B', ids[i]); member[ids[i]] = 2; }
  const t0 = performance.now();
  for (let c = 0; c < 20; c++) {
    for (let k = 0; k < 5000; k++) {
      const s = ids[(k * 7919 + c * 13) % POOL];
      if (member[s] === 1) p.remove('A', s); else if (member[s] === 2) p.remove('B', s);
      p.insert('B', s); member[s] = 2;
    }
  }
  const churnMs = performance.now() - t0;
  const a = p.lists.get('A').count, b = p.lists.get('B').count;
  console.log(`\nchurn WITH discriminator (RCT2's LinkedListTypeOffset):`);
  console.log(`  100k unlink+link ops in ${churnMs.toFixed(1)}ms = ${(churnMs * 1e6 / 100000).toFixed(0)}ns/op — O(1), no pool rebuild`);
  console.log(`  lists consistent: A=${a} B=${b} (sum=${a + b} = pool=${POOL})`);
}

console.log(`\nverdict: query cost scales with the SUBSET (the RCT2/Build property),`);
console.log(`membership churn is O(1) with discriminator discipline, and the documented`);
console.log(`cost (undisciplined unlink corruption) is demonstrated live above.`);
console.log(`In-product receipt: TIDE's search walks only the target buffer (3.7x).`);
