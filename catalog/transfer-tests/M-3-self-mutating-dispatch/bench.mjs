// M-3 transfer test: self-mutating dispatch — deferred vs transition-time
// rebind application.
//
// Mechanism under test (binary-anchored):
//   TH04 `checkThreadRequests`/AW `checkThreadRequests()`: PC/pointer rebinds
//   requested during a frame are applied BETWEEN frames (vm.cpp:400-440,
//   threadsData[REQUESTED_PC_OFFSET] -> applied after the full pass).
//   Doom contrast: state-transition actions execute INLINE at the transition
//   (p_mobj.c:76-78, `st->action.acp1(mobj)`).
//
// Experiment: a 64-thread chain (AW's VM_NUM_THREADS=64). Thread i's fire
// action triggers thread i+1 by zeroing its countdown. Trigger thread 0 once.
// Process each thread once per frame, in two iteration orders:
//   order A = [0..63],  order B = [63..0]  (an implementation detail)
//
//   naive-immediate  : transitions + actions execute inline during the pass
//                      (the common modern pattern: state changed where handled)
//   deferred (TH04/AW): transitions recorded during the pass, applied after it
//
// Measured: frames until all 64 fire, and the per-frame event timeline, for
// each (variant x order). Property claim: deferred dispatch makes the cascade
// INDEPENDENT of iteration order; inline cascades make it implementation-defined.

const N = 64;                 // AW's VM_NUM_THREADS
const FRAMES = 200;
const IDLE = 0, ARMED = 1, FIRED = 2;

function runCascade(variant, order) {
  const threads = [];
  for (let i = 0; i < N; i++) threads.push({ state: ARMED, countdown: Infinity });
  threads[0].countdown = 0;   // the single trigger

  let eventCount = 0;
  const timeline = [];                    // events fired per frame
  let allFiredFrame = -1;

  for (let frame = 0; frame < FRAMES; frame++) {
    const requests = [];                  // deferred: {thread, newState, trigger}
    let firedThisFrame = 0;

    const fireAction = (i) => {           // the transition's action function
      eventCount++; firedThisFrame++;
      const next = (i + 1) % N;
      threads[next].countdown = 0;        // trigger the next link
    };

    for (const i of order) {
      const t = threads[i];
      if (t.state === ARMED) {
        t.countdown--;
        if (t.countdown < 0) {
          if (variant === 'naive') {
            // transition + action INLINE (Doom-faithful immediate pattern)
            t.state = FIRED; fireAction(i);
          } else {
            // record the transition; action runs at frame end (TH04/AW)
            requests.push({ i, fire: true });
          }
        }
      }
    }

    if (variant === 'deferred') {
      // checkThreadRequests: apply ALL recorded transitions after the pass
      for (const r of requests) {
        if (threads[r.i].state === ARMED) {   // guard: still valid at apply time
          threads[r.i].state = FIRED; fireAction(r.i);
        }
      }
    }

    timeline.push(firedThisFrame);
    if (allFiredFrame === -1 && eventCount >= N) allFiredFrame = frame + 1;
  }
  return { eventCount, timeline, allFiredFrame };
}

const A = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63];
const B = [...A].reverse();

console.log('=== M-3 transfer test: deferred vs inline self-mutating dispatch ===');
console.log(`chain of ${N} threads; ONE trigger; two task iteration orders\n`);
console.log('variant  | order    | frames until all 64 fired | total events');
const results = {};
for (const variant of ['naive', 'deferred']) {
  for (const [label, order] of [['A fwd', A], ['B rev', B]]) {
    const r = runCascade(variant, order);
    results[`${variant}/${label}`] = r;
    console.log(`${variant.padEnd(8)} | ${label.padEnd(8)} | ${String(r.allFiredFrame).padEnd(25)} | ${r.eventCount}`);
  }
}

const nt = results['naive/A fwd'].timeline, ntr = results['naive/B rev'].timeline;
const dt = results['deferred/A fwd'].timeline, dtr = results['deferred/B rev'].timeline;
const firstDiff = nt.findIndex((v, i) => v !== ntr[i]);
console.log(`\nnaive:    per-frame event timelines ${firstDiff === -1 ? 'match' : `DIVERGE at frame ${firstDiff}`} (cascade depends on iteration order)`);
const dFirstDiff = dt.findIndex((v, i) => v !== dtr[i]);
console.log(`deferred: per-frame event timelines ${dFirstDiff === -1 ? 'MATCH — order-independent cascade' : `diverge at frame ${dFirstDiff}`}`);
console.log(`\ncost of the guarantee: deferred adds cascade latency (${results['deferred/A fwd'].allFiredFrame} frames vs naive's best-case ${results['naive/A fwd'].allFiredFrame})`);
