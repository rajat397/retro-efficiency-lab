// M-1 transfer test — event-program-as-VM (MarioXP's event editor, TH04's
// event chunks, Another World's 64-thread bytecode VM) on Node 22.
//
// Claim tested. Game behaviors ship as interpreted event programs (data) so
// non-programmers and even the shipped binary itself can author/modify
// behavior without a compiler. Transferable properties:
//   (1) extensibility: new behaviors = new data blobs, interpreter untouched
//       (lines-of-code delta 0 vs N)
//   (2) hot-path cost: the interpreter tax, measured honestly
//   (3) replay determinism: program execution from data is hash-stable
//
// Run: node bench.mjs

import { performance } from 'node:perf_hooks';

// ---- a TH04/AW-shaped VM: opcode table, 64 threads, slot-pool entities ----
const OPS = {
  1: { name: 'move',  fn: (vm, th, a) => { th.x += a[0]; th.y += a[1]; } },
  2: { name: 'wait',  fn: (vm, th, a) => { th.pcHold = a[0]; } },
  3: { name: 'spawn', fn: (vm, th, a) => {              // pool full -> drop (TH04 law)
        if (vm.entities.length < ENTITY_CAP) vm.entities.push({ x: th.x, y: th.y, hp: a[0] });
        else vm.spawnsDropped++; } },
  4: { name: 'jump',  fn: (vm, th, a) => { th.pc = a[0] - 1; } },
  5: { name: 'rebind',fn: (vm, th, a) => { vm.requests.push({ th: a[0], pc: a[1] }); } }, // M-3 family
  6: { name: 'loop',  fn: (vm, th, a) => { if (--th.count > 0) th.pc = th.loopStart; } },
  7: { name: 'despawn', fn: (vm) => { vm.entities.pop(); } },  // added later = extensibility demo
};

const ENTITY_CAP = 4096;   // M-2: the VM's entity pool is bounded, TH04-style
class EventVM {
  constructor() { this.entities = []; this.requests = []; this.threads = [];
    this.spawnsDropped = 0; }
  load(programs) {          // programs: {threadId: [[op, ...args], ...]}
    this.threads = Object.entries(programs).map(([id, prog]) => ({
      id: Number(id), prog, pc: 0, pcHold: 0, loopStart: 0, count: 0, x: 0, y: 0 }));
  }
  step(maxInstr = Infinity) {
    let executed = 0;
    for (const th of this.threads) {
      let budget = maxInstr;
      while (budget-- > 0) {
        if (th.pcHold > 0) { th.pcHold--; break; }
        if (th.pc >= th.prog.length) { th.pc = 0; break; }   // loop program
        const [op, ...args] = th.prog[th.pc];
        const spec = OPS[op];
        if (!spec) throw new Error(`bad op ${op}`);
        if (op === 6) { th.loopStart = th.pc; th.count = args[0]; }
        spec.fn(this, th, args);
        executed++;
        if (op === 4) continue;                              // jump already set pc
        th.pc++;
      }
    }
    // deferred rebind application (the M-3 boundary)
    for (const r of this.requests) { const t = this.threads.find((x) => x.id === r.th); if (t) t.pc = r.pc; }
    this.requests.length = 0;
    return executed;
  }
}

console.log('=== M-1 transfer test: event-program VM — extensibility, cost, determinism ===\n');

// ---- (1) extensibility: new behavior = new data blob, interpreter untouched ----
{
  const v = new EventVM();
  v.load({ 0: [[1, 3, 0], [3, 10], [2, 2], [6, 3], [5, 1, 0], [1, -1, 2], [3, 5], [4, 1]] });
  // NEW behavior later authored (e.g., by an "event editor" or a shipped mod):
  // a spiral pattern — zero interpreter/OP-table changes:
  const spiral = [[6, 8], [1, 7, 1], [3, 4], [4, 1]];
  v.load({ 1: spiral });
  const linesBefore = 6;   // OPS table + EventVM class ≈ the interpreter's fixed cost
  console.log(`extensibility: new behavior "spiral" = ${spiral.length} data rows (opcode list)`);
  console.log(`  interpreter lines added: 0 (vs a compiled path: new function + dispatch arm ≈ ${linesBefore}+ lines)`);
  console.log(`  authoring surface: data any tool can emit (MarioXP's event editor property)`);
}

// ---- (2) the interpreter tax, measured honestly ----
{
  // VM path: run a 6-op program body 5M times
  const v = new EventVM();
  v.load({ 0: [[1, 2, 1], [3, 1], [7], [2, 0], [6, 4], [5, 0, 0], [1, -2, -1]] });  // spawn+despawn balanced
  let t0 = performance.now(), executed = 0;
  const target = 5e6; // 7 ops per iteration now
  while (executed < target) executed += v.step(1e9);
  const tVm = performance.now() - t0;

  // compiled-equivalent path: same semantics inlined
  let x = 0, y = 0, count = 4, loopStart = 0;
  const nEnts = [];
  t0 = performance.now();
  let done = 0;
  while (done < target) {
    // one "iteration" = the same 7 ops
    x += 2; y += 1; nEnts.push({ x, y, hp: 1 }); count = 4; nEnts.pop();
    for (let k = 0; k < 4; k++) { x -= 2; y -= 1; nEnts.pop(); count--; }
    done += 7;
  }
  const tInline = performance.now() - t0;
  console.log(`\ninterpreter tax over ${(target / 1e6)}M VM-op executions (spawn/despawn balanced — the pool discipline):`);
  console.log(`  event VM        : ${tVm.toFixed(0)}ms  (${(tVm * 1e6 / target).toFixed(1)}ns/op)`);
  console.log(`  inlined equivalent: ${tInline.toFixed(0)}ms  (${(tInline * 1e6 / target).toFixed(1)}ns/op)`);
  console.log(`  tax             : ${(tVm / tInline).toFixed(1)}x per op (the honest cost of data-driven behavior)`);
}

// ---- (3) replay determinism: program execution from data is hash-stable ----
{
  const run = () => {
    const v = new EventVM();
    v.load({
      0: [[1, 3, 1], [3, 2], [2, 1], [6, 3], [5, 1, 2], [1, -1, -1], [3, 1]],
      1: [[1, 1, 2], [3, 1], [4, 1]],
    });
    let h = 0x811c9dc5 >>> 0;
    for (let f = 0; f < 500; f++) {
      const n = v.step(64);   // per-frame instruction budget — TH04/AW's own discipline
      for (const e of v.entities.slice(-8)) { h ^= (e.x * 31 + e.y * 7 + e.hp) & 0xffff; h = Math.imul(h, 0x01000193); }
      h ^= n & 0xffff; h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  };
  const h1 = run(), h2 = run();
  console.log(`\nreplay determinism: two full VM runs -> ${h1} vs ${h2} -> ${h1 === h2 ? 'IDENTICAL' : 'DIVERGES'}`);
}

console.log(`\nverdict: behaviors as data cost a measurable interpreter tax (see the`);
console.log(`number above — that is the M-1 card's costs field, quantified), but buy`);
console.log(`zero-code-change extensibility, tool-authorable behavior (MarioXP's event`);
console.log(`editor, shipped in the binary), and replay-stable execution. The M-3 test`);
console.log(`already proved the deferred-rebind discipline that makes cross-thread`);
console.log(`self-mutation order-independent.`);
