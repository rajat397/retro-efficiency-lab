### M-4 Replay determinism via fixed-size input recordings (`determinism`)

**Mechanism.** The simulation is a pure function of a fixed-timestep input stream, so
an "attract mode demo" is just a fixed-size file of recorded *inputs* (not video),
replayed by shifting frames into the live input path — replay = execution.

**Witnesses.** TH04 `MAIN.EXE` (binary + ReC98 `demo.cpp`); Doom's lumps + demo
system (queued second witness, same idea documented publicly since 1993).

**Evidence.**
- Binary: `DEMO0.REC` string @ `0x3152d` with **no static xref** — ReC98 explains:
  `demo_fn[4] = '0' + demo_num` patches the digit at runtime (dynamic filename
  construction defeats string-xref search; recorded as method learning).
- ReC98 `th04/main/demo.cpp` (read-only): `demo_load()` =
  `hmem_allocbyte(sizeof(REC<DEMO_N>))` + `file_read` — **fixed-size input recording**;
  `DemoPlay()` applies recorded frames via a binary op into the input system;
  TH04 playback ends on any keypress.
- Attract demos are a core commercial feature of the game → the input-stream contract
  (deterministic sim) is load-bearing, not incidental.

**Generalization.** Rollback netcode, replay-based CI for game/physics bugs
(repro = byte-exact input file), audit logs that are *executions*, time-travel
debugging. Modern framing: store inputs, derive everything else.

**Costs.** Every floating-point or wall-clock read poisons the stream (forces the
fixed-point/LUT discipline — see M-2's 8-bit subpixel speeds); recordings are useless
across sim versions; input format changes break archives.

**Status.** **cataloged** — two engine-family witnesses (TH04 1998 Borland/asm;
Doom 1993 id Tech 1/C). The demo format differs (fixed-size block vs length-
bounded stream with 0x80 sentinel) but the contract is identical: record inputs,
derive everything else, replay = execution.
