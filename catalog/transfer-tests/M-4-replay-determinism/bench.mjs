// M-4 transfer test: replay determinism — fixed-tic/fixed-point sim vs the
// modern float + variable-dt idiom, under DIFFERENT machine-load jitter.
//
// Contract (from the witnesses):
//   Doom: 4 bytes/tic of pure input, fixed 35 Hz sim, fixed_t Q16.16,
//         DEMOMARKER sentinel (d_main.c:1493, TICRATE, m_fixed.h)
//   TH04: REC<DEMO_N> fixed-size input recording, 8-bit subpixel sim
//
// Experiment: record an input stream once (seeded). Simulate a world of
// moving entities + a global "wind" input applied per tic. Then REPLAY the
// same recording under a DIFFERENT frame-timing jitter (as if the replay ran
// on a machine with different load). 
//   - Fixed-tic sim (A): dt is part of the architecture (35 Hz), so jitter
//     only affects rendering, never sim state -> replay must be byte-identical.
//   - Variable-dt sim (B): dt = frameTime * jitter, where frameTime is machine
//     noise NOT stored in the recording -> replay diverges. Measure first
//     divergence tick, final drift, and fraction of entities diverged.
//
// State hashing: FNV-1a over the state arrays every 500 ticks.

const TICKS = 6000;
const ENTITY_CAP = 4096;
const SPAWN_PER_TICK = 8;
const SUBPIXEL = 16;
const FIELD_W = 384 * SUBPIXEL, FIELD_H = 448 * SUBPIXEL;
const MAX_AGE = 900;
const HASH_EVERY = 500;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fnv(stateArrs) {
  let h = 0x811c9dc5;
  for (const arr of stateArrs) {
    for (let i = 0; i < arr.length; i++) {
      h ^= arr[i] & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (arr[i] >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (arr[i] >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (arr[i] >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---- record the input stream once (the only thing stored, Doom-style) ----
const rngRec = mulberry32(0xBEEF);
const inputs = [];                     // [windX, windY, killRoll] per tick
for (let t = 0; t < TICKS; t++) {
  inputs.push([
    Math.round((rngRec() * 2 - 1) * 8),          // wind X (subpixel units)
    Math.round((rngRec() * 2 - 1) * 8),          // wind Y
    (rngRec() * 65536) | 0,                      // per-tic kill lottery
  ]);
}

// two DIFFERENT machine-load jitter streams (frame times the machine produced)
function makeJitter(seed) {
  const rng = mulberry32(seed);
  return () => 0.6 + rng() * 0.9;      // 0.6x .. 1.5x frame-time multiplier
}
const jitterA = makeJitter(0xA11CE);  // replay machine #1
const jitterB = makeJitter(0xD1FF);   // replay machine #2 (different load)

// ------------------------------------------- A: fixed-tic fixed-point sim ----
function simFixedTic(replayJitter) {
  const X = new Int32Array(ENTITY_CAP), Y = new Int32Array(ENTITY_CAP);
  const VX = new Int32Array(ENTITY_CAP), VY = new Int32Array(ENTITY_CAP);
  const AGE = new Int32Array(ENTITY_CAP);
  const hashes = [];
  let population = 0, firstHash = null;
  const rngSp = mulberry32(0xC0FFEE);   // spawn-position RNG (part of the
  // seed setup, conceptually fixed at level load — NOT machine-dependent)
  let kill = 0;
  let consumedJitter = 0;

  for (let t = 0; t < TICKS; t++) {
    // fixed 35 Hz: NO dt in the state equations. Jitter affects nothing.
    consumedJitter += replayJitter();   // frame time exists; sim ignores it
    const [wx, wy, killRoll] = inputs[t];
    // spawn
    for (let s = 0; s < SPAWN_PER_TICK && population < ENTITY_CAP; s++) {
      X[population] = (FIELD_W * rngSp()) | 0; Y[population] = (FIELD_H * rngSp()) | 0;
      VX[population] = ((rngSp() * 2 - 1) * 3 * SUBPIXEL) | 0;
      VY[population] = ((rngSp() * 2 - 1) * 3 * SUBPIXEL) | 0;
      AGE[population] = 0; population++;
    }
    // update: integer, fixed step
    for (let i = 0; i < population; i++) {
      X[i] += VX[i] + wx; Y[i] += VY[i] + wy; AGE[i]++;
      if (X[i] < 0 || X[i] >= FIELD_W) VX[i] = -VX[i];
      if (Y[i] < 0 || Y[i] >= FIELD_H) VY[i] = -VY[i];
      if (AGE[i] >= MAX_AGE) { VX[i] = 0; VY[i] = 0; }   // rest, not free (keeps state space stable)
    }
    if (t % HASH_EVERY === HASH_EVERY - 1) {
      const h = fnv([X, Y, VX, VY, AGE]);
      hashes.push(h);
      if (firstHash === null) firstHash = h;
    }
  }
  return { hashes, population, consumedJitter };
}

// ------------------------------------- B: float sim, variable dt (modern) ----
function simFloatDt(replayJitter) {
  const X = new Float64Array(ENTITY_CAP), Y = new Float64Array(ENTITY_CAP);
  const VX = new Float64Array(ENTITY_CAP), VY = new Float64Array(ENTITY_CAP);
  const AGE = new Float64Array(ENTITY_CAP);
  const hashes = [];
  let population = 0;
  const rngSp = mulberry32(0xC0FFEE);
  let consumedJitter = 0;

  for (let t = 0; t < TICKS; t++) {
    // variable dt: the sim equation CONTAINS machine timing
    const frameMs = 16.6 * replayJitter();
    consumedJitter += frameMs;
    const dt = frameMs / 16.6;                    // 0.6x..1.5x — load-dependent
    const [wx, wy] = inputs[t];                   // inputs in subpixel: scale down
    const wfx = wx / SUBPIXEL, wfy = wy / SUBPIXEL;
    for (let s = 0; s < SPAWN_PER_TICK && population < ENTITY_CAP; s++) {
      X[population] = (FIELD_W * rngSp()) / SUBPIXEL; Y[population] = (FIELD_H * rngSp()) / SUBPIXEL;
      VX[population] = ((rngSp() * 2 - 1) * 3); VY[population] = ((rngSp() * 2 - 1) * 3);
      AGE[population] = 0; population++;
    }
    for (let i = 0; i < population; i++) {
      X[i] += VX[i] * dt + wfx; Y[i] += VY[i] * dt + wfy; AGE[i] += dt;
      if (X[i] < 0 || X[i] >= FIELD_W / SUBPIXEL) VX[i] = -VX[i];
      if (Y[i] < 0 || Y[i] >= FIELD_H / SUBPIXEL) VY[i] = -VY[i];
      if (AGE[i] >= MAX_AGE) { VX[i] = 0; VY[i] = 0; }
    }
    if (t % HASH_EVERY === HASH_EVERY - 1) hashes.push(fnv([X, Y, VX, VY]));
  }
  return { hashes, population, consumedJitter };
}

// ---- run: record-path machine vs two replay machines with different load ----
const a1 = simFixedTic(jitterA);
const a2 = simFixedTic(jitterB);
const b1 = simFloatDt(jitterA);
const b2 = simFloatDt(jitterB);

let aDiverge = -1, bDiverge = -1;
for (let i = 0; i < a1.hashes.length; i++) if (a1.hashes[i] !== a2.hashes[i]) { aDiverge = i; break; }
for (let i = 0; i < b1.hashes.length; i++) if (b1.hashes[i] !== b2.hashes[i]) { bDiverge = i; break; }

console.log('=== M-4 transfer test: replay determinism under different machine load ===');
console.log(`ticks=${TICKS} input stream: ONE recording, replayed twice per sim type`);
console.log('replay machines differ ONLY in frame-timing jitter (machine load)\n');
console.log(`A fixed-tic/fixed-point (Doom/TH04 style):`);
console.log(`  replay #1 hash0=${a1.hashes[0]} hashEnd=${a1.hashes[a1.hashes.length-1]}`);
console.log(`  replay #2 hash0=${a2.hashes[0]} hashEnd=${a2.hashes[a2.hashes.length-1]}`);
console.log(`  first divergence: ${aDiverge === -1 ? 'NONE — byte-identical replay across all ' + a1.hashes.length + ' checkpoints' : 'tick ' + (aDiverge+1) * HASH_EVERY}`);
console.log(`  sim consumed jitter: #1 consumed ${a1.consumedJitter.toFixed(0)}ms, #2 consumed ${a2.consumedJitter.toFixed(0)}ms (state unaffected)\n`);
console.log(`B float + variable-dt (modern naive):`);
console.log(`  replay #1 hash0=${b1.hashes[0]} hashEnd=${b1.hashes[b1.hashes.length-1]}`);
console.log(`  replay #2 hash0=${b2.hashes[0]} hashEnd=${b2.hashes[b2.hashes.length-1]}`);
console.log(`  first divergence: ${bDiverge === -1 ? 'none' : 'checkpoint ' + (bDiverge+1) + ' (~tick ' + (bDiverge+1) * HASH_EVERY + ')'}`);
console.log(`  sim consumed jitter: #1 ${b1.consumedJitter.toFixed(0)}ms vs #2 ${b2.consumedJitter.toFixed(0)}ms (dt IS state)\n`);
console.log(aDiverge === -1 && bDiverge !== -1
  ? 'VERDICT: replay determinism is architectural. Same recording, different machine'
    + ' load: fixed-tic replays byte-identically; the float/variable-dt sim never'
    + ' replays — machine timing leaked into game state because dt became part of'
    + ' the equations.'
  : 'VERDICT: unexpected result — investigate.');
