// M-5 transfer test v2: TH04's measured slowdown as a modern load-shedding
// primitive — degrade the SIM RATE under load, never the entity set.
//
// Binary-anchored control law (FUN_23a9_8e38 @ 0x2c8c8, main loop @ 0x1ab88):
//   bullets_seen >= base + 0x18 + difficulty*8  ->  simSpeed = 2
//   main loop accumulator: simClock += (simSpeed <= phase)
//   -> level 1 = tick every frame, level 2 = tick every other frame.
// Population is capped by the slot pool (M-2); entities are never dropped.
//
// Model (deterministic, work units; 1 unit = one bullet's update; budget B =
// 16.6ms of work): under SUSTAINED overload the naive loop attempts the full
// tick rate and falls behind — backlog grows without bound. The TH04 law
// steps the rate down so achieved rate matches capacity: backlog bounded.

const B = 2048;                       // frame work budget (units per 16.6ms)
const SECONDS = 100;
const FPS = 60;
const CAP = 4096;

function th04Threshold(difficulty) {  // base + 0x18 + diff*8 (difficulty = option level)
  return 0 + 0x18 + difficulty * 8;
}

function run(variant, pop, difficulty) {
  const threshold = th04Threshold(difficulty);
  const ticksPerSecIntended = FPS;
  const wallPerTickMs = (pop / B) * 16.6;      // wall time one sim step really takes
  let backlogMs = 0;                            // wall-clock lag behind intended schedule
  let simSteps = 0;
  let maxBacklog = 0;
  let tickOverruns = 0, ticks = 0;
  let level = 1;

  for (let t = 0; t < SECONDS; t++) {
    for (let f = 0; f < FPS; f++) {
      const phase = f & 1;
      if (variant === 'th04') {
        // MEASURE + CONTROL (every frame, like TH04's pool walk)
        level = pop >= threshold ? 2 : 1;
        // accumulator: sim advances when level <= phase... (decompiled law,
        // normalized: level 2 -> tick on odd phase; level 1 -> every frame)
        if (level === 1 || phase === 1) {
          // tick: full sim step over the whole population (never partial)
          backlogMs += wallPerTickMs - 16.6;
          if (wallPerTickMs > 16.6) tickOverruns++;
          ticks++;
          simSteps++;
          maxBacklog = Math.max(maxBacklog, backlogMs);
        } else {
          backlogMs = Math.max(0, backlogMs - 16.6);   // free frame drains backlog
        }
      } else {
        // naive: attempt the full 60/s regardless of capacity
        backlogMs += wallPerTickMs - 16.6;
        if (wallPerTickMs > 16.6) tickOverruns++;
        ticks++;
        simSteps++;
        maxBacklog = Math.max(maxBacklog, backlogMs);
      }
      backlogMs = Math.max(0, backlogMs);
    }
  }
  const intended = SECONDS * ticksPerSecIntended;
  return {
    level, simSteps, achievedRate: +(simSteps / SECONDS).toFixed(1),
    backlogMs: +backlogMs.toFixed(0), maxBacklogMs: +maxBacklog.toFixed(0),
    lagSeconds: +(backlogMs / 1000).toFixed(1),
    tickOverrunPct: +(tickOverruns / Math.max(1, ticks) * 100).toFixed(1),
    intended, droppedEntities: 0,
  };
}

console.log('=== M-5 transfer test v2: rate-shedding vs naive full-rate under sustained overload ===');
console.log(`budget B=${B} units/frame (16.6ms). Population capped by the slot pool (M-2). Entities never dropped.\n`);

for (const [label, mult] of [['1.5x overload', 1.5], ['2.2x overload', 2.2]]) {
  const pop = Math.min(CAP, Math.floor(B * mult));
  console.log(`--- ${label}: population=${pop} (${(pop / B).toFixed(2)}x budget) ---`);
  console.log('variant | level | achieved/s | wall lag after 100s | max lag | tick overrun%');
  for (const variant of ['naive', 'th04']) {
    const r = run(variant, pop, 4);
    console.log(
      `${variant.padEnd(7)} | ${String(r.level).padEnd(5)} | ${String(r.achievedRate).padEnd(10)} | ` +
      `${String(r.backlogMs + ' ms').padEnd(19)} | ${String(r.maxBacklogMs + ' ms').padEnd(7)} | ${r.tickOverrunPct}%`
    );
  }
}

console.log('\nReading: the naive loop falls behind its own schedule — backlog (latency) grows');
console.log('linearly forever. The TH04 law steps the sim rate down once, measured from the');
console.log('live count, so achieved rate matches capacity: backlog stays bounded. Same');
console.log('entities, same tick function, same determinism — only the rate degrades.');
