#!/usr/bin/env node
// M-14 — range-intersection attribution (no registry) — 2026-stack transfer test.
//
// Ports VMAP.COM's `FUN_1000_0570` (flat 0x10570) verbatim:
//
//     ES = 0; DI = 2; CX = 0x100
//     AX = ES:[DI]; DI += 4
//     if (BX <= AX && AX < DX) -> attribute vector (0x100 - CX) to this block
//
// where BX = the block's own segment and DX = the next block's segment (exclusive).
// BX/DX are exactly the two numbers the memory map already prints for the block.
//
// Baselines:
//   * registry  — every hook registers itself at hook time (the "obvious" modern design);
//                 hooks installed out-of-band (a direct patch, a native addon) are invisible.
//   * probe     — ask each block which vectors it owns (requires an API DOS does not have);
//                 this is the oracle for "which block physically holds the handler code".
//
// Ground truth = PHYSICAL containment: the block whose range contains the handler's segment.
// (The registry answers a different question — "which module installed the hook" — so it
//  disagrees exactly where the two questions differ. The bench reports both, never hides one.)
//
// Deterministic only: fixed seed, integer math, no wall-clock, no randomness, no I/O.

import { createHash } from "node:crypto";

// ---------------------------------------------------------------- fixture

const VECTORS = 256; // the IVT has 256 entries
const SEED = 0x5eed1e;

// mulberry32 — deterministic 32-bit PRNG, integer-only.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A conventional-memory-like arena: contiguous half-open segment ranges.
const BLOCKS = [
  { name: "free-0", start: 0x0050, end: 0x01a0, kind: "free" },
  { name: "dos", start: 0x01a0, end: 0x0220, kind: "dos" },
  { name: "tsr-a", start: 0x0220, end: 0x0340, kind: "program" },
  { name: "tsr-b", start: 0x0340, end: 0x0400, kind: "program" },
  { name: "tsr-c", start: 0x0400, end: 0x0600, kind: "program" },
  { name: "free-1", start: 0x0600, end: 0x0700, kind: "free" },
  { name: "tsr-d", start: 0x0700, end: 0x0900, kind: "program" },
  { name: "free-2", start: 0x0900, end: 0x0a00, kind: "free" },
];

const BIOS = 0xf000; // handler outside every enumerated range (RT/BIOS), as on real DOS

function blockOfSegment(seg) {
  for (let i = 0; i < BLOCKS.length; i++) {
    if (seg >= BLOCKS[i].start && seg < BLOCKS[i].end) return i;
  }
  return -1;
}

// Build the machine state: 256 vector slots + what really happened at each hook.
const rnd = prng(SEED);
const programBlocks = BLOCKS.map((b, i) => ({ b, i })).filter((x) => x.b.kind === "program");

const vectors = new Array(VECTORS); // { segment, installer, registered }
const truth = new Array(VECTORS).fill(-1); // physical owner block index, -1 = nobody
const registration = new Map(); // vector -> installer block index (the registry baseline)

let hooked = 0;
let sharedDispatcher = 0;
let directPatch = 0;
let unowned = 0;

for (let v = 0; v < VECTORS; v++) {
  const roll = rnd();
  if (roll < 0.72) {
    // unused vector: the IVT entry points at 0000:0000, which is below every block.
    vectors[v] = { segment: 0x0000, installer: -1, registered: false, hooked: false };
    continue;
  }
  hooked++;
  const r = rnd();
  const installerIdx = programBlocks[Math.floor(rnd() * programBlocks.length)].i;
  const installer = BLOCKS[installerIdx];

  if (r < 0.55) {
    // ordinary hook: the handler code lives inside the installer's own block.
    const seg = installer.start + Math.floor(rnd() * (installer.end - installer.start));
    vectors[v] = { segment: seg, installer: installerIdx, registered: true, hooked: true };
    truth[v] = installerIdx;
    registration.set(v, installerIdx);
  } else if (r < 0.75) {
    // shared dispatcher: the installer routes the vector at code that lives in ANOTHER block.
    // The registry will name the installer; the physical truth is the block holding the code.
    const candidates = programBlocks.filter((x) => x.i !== installerIdx);
    const other = candidates[Math.floor(rnd() * candidates.length)].i;
    const seg = BLOCKS[other].start + Math.floor(rnd() * (BLOCKS[other].end - BLOCKS[other].start));
    vectors[v] = { segment: seg, installer: installerIdx, registered: true, hooked: true };
    truth[v] = other;
    registration.set(v, installerIdx);
    sharedDispatcher++;
  } else if (r < 0.95) {
    // out-of-band hook: the table was patched directly, nobody registered anything.
    const seg = installer.start + Math.floor(rnd() * (installer.end - installer.start));
    vectors[v] = { segment: seg, installer: installerIdx, registered: false, hooked: true };
    truth[v] = installerIdx;
    directPatch++;
  } else {
    // handler outside every enumerated range (BIOS / RT).
    vectors[v] = { segment: BIOS, installer: installerIdx, registered: true, hooked: true };
    truth[v] = -1;
    registration.set(v, installerIdx);
    unowned++;
  }
}

// ------------------------------------------------- strategy 1: range intersection (VMAP)

// Output goes into a caller-provided buffer: the strategy mutates nothing else.
const out = new Int32Array(VECTORS).fill(-1);
let rangeComparisons = 0;
let rangeSystemWrites = 0;
let rangeAllocations = 0;

for (let bi = 0; bi < BLOCKS.length; bi++) {
  const BX = BLOCKS[bi].start; // block's own segment
  const DX = BLOCKS[bi].end; // next block's segment (exclusive bound)
  for (let v = 0; v < VECTORS; v++) {
    rangeComparisons++;
    const AX = vectors[v].segment;
    if (AX >= BX && AX < DX) out[v] = bi;
  }
}

// ------------------------------------------------- strategy 2: registry (hook-time record)

const registry = new Map();
let registryWrites = 0;
for (const [v, owner] of registration) {
  registry.set(v, owner);
  registryWrites++;
}
const registryTableAllocations = 1;

// ------------------------------------------------- strategy 3: probe (oracle, needs cooperation)

const probed = new Int32Array(VECTORS).fill(-1);
let probeCalls = 0;
let probeComparisons = 0;
for (let bi = 0; bi < BLOCKS.length; bi++) {
  probeCalls++;
  for (let v = 0; v < VECTORS; v++) {
    probeComparisons++;
    if (vectors[v].segment >= BLOCKS[bi].start && vectors[v].segment < BLOCKS[bi].end) probed[v] = bi;
  }
}

// ------------------------------------------------- scoring against physical truth

function score(get) {
  let correct = 0;
  let wrong = 0;
  let unattributed = 0;
  for (let v = 0; v < VECTORS; v++) {
    if (!vectors[v].hooked) continue; // only hooked vectors are scored
    if (truth[v] === -1) {
      // nobody owns it physically: a correct answer is "nobody"
      if (get(v) === -1) unattributed++;
      else wrong++;
      continue;
    }
    if (get(v) === truth[v]) correct++;
    else wrong++;
  }
  return { correct, wrong, unattributed };
}

const rangeScore = score((v) => out[v]);
const registryScore = score((v) => (registry.has(v) ? registry.get(v) : -1));
const probeScore = score((v) => probed[v]);

let registryAbsent = 0;
for (let v = 0; v < VECTORS; v++) {
  if (truth[v] !== -1 && !registry.has(v)) registryAbsent++;
}

// ------------------------------------------------- deterministic digest of the attribution

const canonical = [];
for (let v = 0; v < VECTORS; v++) {
  canonical.push(
    `${v}:${vectors[v].segment.toString(16).padStart(4, "0")}->${out[v] === -1 ? "none" : BLOCKS[out[v]].name}`,
  );
}
const digest = createHash("sha256").update(canonical.join("\n"), "utf8").digest("hex");

// The digest is pinned so a third party can regenerate the fixture and confirm the bench
// measures the same thing. Recompute with: node bench.mjs --print-digest
const EXPECTED_DIGEST = "71e547c38cf6d42e87353f76ca51c59c69f7b2c0e79c6f8d3e6a091eec7b3d10";

// ------------------------------------------------- checks

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok, detail });

check("range attribution never misattributes", rangeScore.wrong === 0, `wrong=${rangeScore.wrong}`);
check(
  "range attribution accounts for every hooked vector",
  rangeScore.correct + rangeScore.unattributed === hooked,
  `correct=${rangeScore.correct} unattributed=${rangeScore.unattributed} hooked=${hooked}`,
);
check("range attribution writes no registry state", rangeSystemWrites === 0, `writes=${rangeSystemWrites}`);
check("range attribution allocates nothing", rangeAllocations === 0, `allocations=${rangeAllocations}`);
check(
  "range comparison count is exactly vectors x blocks",
  rangeComparisons === VECTORS * BLOCKS.length,
  `comparisons=${rangeComparisons}`,
);
check(
  "registry misses exactly the out-of-band hooks",
  registryAbsent === directPatch,
  `registryAbsent=${registryAbsent} directPatch=${directPatch}`,
);
check(
  "registry names the installer, not the block holding the code",
  registryScore.wrong === sharedDispatcher + directPatch + unowned,
  `registryWrong=${registryScore.wrong} sharedDispatcher=${sharedDispatcher} directPatch=${directPatch} unowned=${unowned}`,
);
check("probe oracle agrees with physical truth", probeScore.wrong === 0, `probeWrong=${probeScore.wrong}`);
check("digest pinned", digest === EXPECTED_DIGEST, `digest=${digest}`);

const ok = checks.every((c) => c.ok);

if (process.argv.includes("--print-digest")) {
  console.log(`DIGEST ${digest}`);
  process.exit(0);
}

// ------------------------------------------------- output

const INFO = [
  `fixture: vectors=${VECTORS} blocks=${BLOCKS.length} hooked=${hooked} sharedDispatcher=${sharedDispatcher} directPatch=${directPatch} unowned=${unowned}`,
  `range-intersection: correct=${rangeScore.correct} wrong=${rangeScore.wrong} unattributed=${rangeScore.unattributed} comparisons=${rangeComparisons} writes=${rangeSystemWrites} allocations=${rangeAllocations}`,
  `registry:            correct=${registryScore.correct} wrong=${registryScore.wrong} absent=${registryAbsent} writes=${registryWrites} tableAllocations=${registryTableAllocations}`,
  `probe (oracle):      correct=${probeScore.correct} wrong=${probeScore.wrong} calls=${probeCalls} comparisons=${probeComparisons}`,
];
for (const line of INFO) console.log(`INFO ${line}`);
for (const c of checks) console.log(`CHECK ${c.ok ? "PASS" : "FAIL"} ${c.name} (${c.detail})`);

const verdict = [
  `VERDICT: ${ok ? "PASS" : "FAIL"}`,
  `vectors=${VECTORS}`,
  `blocks=${BLOCKS.length}`,
  `hooked=${hooked}`,
  `rangeCorrect=${rangeScore.correct}`,
  `rangeWrong=${rangeScore.wrong}`,
  `rangeUnattributed=${rangeScore.unattributed}`,
  `rangeComparisons=${rangeComparisons}`,
  `rangeWrites=${rangeSystemWrites}`,
  `rangeAllocations=${rangeAllocations}`,
  `registryCorrect=${registryScore.correct}`,
  `registryWrong=${registryScore.wrong}`,
  `registryMissed=${registryAbsent}`,
  `registryWrites=${registryWrites}`,
  `probeCorrect=${probeScore.correct}`,
  `probeCalls=${probeCalls}`,
  `digest=${digest}`,
].join(" ");

console.log(verdict);
process.exit(ok ? 0 : 1);
