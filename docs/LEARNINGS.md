# Transferable learnings — the distillation across all targets

Purpose: one place holding what *transfers* out of this lab — skills, architectural
findings, technical findings, and an honest usefulness audit. Per-target evidence
lives in `targets/*/findings*.md` and `catalog/mechanisms/*.md`; this file does not
duplicate it, it distills it and links.

Maintained additively at target closeout. Last updated: 2026-11-13 (after the M-14 VMAP cold run;
the previous note — "after QVM phase 4" — was stale, M-12/M-13 had already landed).

---

## 1. Transferable skills (methodology, not target-specific)

| skill | what it is | where it earned its keep |
|---|---|---|
| **Evidence-first debugging** | pull the verbatim error within the first pass; root-cause both directions (who fed bad input / what the call returned); fix causes, never the log line. Every "weird" finding this session (NE r1=3 forever, ADDRL 8 return-addr overwrite, JIT-mode mislabel) was solved by instrumentation, not guessing. | QVM phases 1–3 |
| **TDD for parsers** | write the RED test against *pinned* fixture bytes before the parser exists; the test becomes the format documentation and catches grammar assumptions (variable-length block hashes, zero-exec dupes). | SQLite VDBE profile parser |
| **Depth classes on findings** | every claim labeled `restated` / `traced` / `measured`; verifier ≠ author; a finding on page 1 of the docs fails the surprise bar. Keeps the catalog honest and upgradeable (RCT2 restated → SQLite measured shows the ladder working). | probe contract (`docs/templates/probe-contract.md`) |
| **Instrument the real thing, never a rewrite** | measurements come from unmodified engine code compiled into a harness with stubbed environment (ioquake3 vm*.c unmodified; SQLite amalgamation built as-is). A rewrite invalidates the number. | QVM harness |
| **Controlled A/B requires identical syscall counts** | engine-mode comparisons are only valid if the workload is deterministic across modes; assert the count equality, and when it drifts, that drift is itself a finding (FP divergence). | QVM phases 3–4 |
| **Run-only-what-you-need scripts** | harnesses print aggregates, never raw dumps; large artifacts are streamed/grepped, never fully loaded. (Also the session-level lesson: repeated full-state re-verification burned context without producing files — "verify" phases were banned in favor of write/run/record.) | session protocol |
| **Probe contracts before dispatch** | 3–5 questions written before touching a target; classes assigned before evidence is collected. | `docs/templates/probe-contract.md` |
| **Bulk-locate, then spend the read budget on the contract's 3–5 functions** | when each deep-analysis call re-imports the artifact (~25 s) and the harness kills background jobs, a bulk disassembly finds the candidate procedures for free and only the contract's anchor procedures get the expensive decompile; write each extracted constant to disk as it is found, so an interrupted run costs minutes instead of the session. Also: `rea xrefs` on a flat address can be empty while the reference exists in the segment-relative space — read the assembly, do not conclude "no reference". | VMAP.COM cold run (M-14) |

## 2. Architectural findings (cross-target, the ones that generalize)

These are the claims with claim-like force. Evidence chains: `catalog/mechanisms/`,
`docs/DECISION-interpret-vs-compile.md`, `docs/decisions.md`.

1. **Behavior-as-payload is a proven pattern, with a measured tax.** Ship a fixed
   interpreter, put behavior in data (M-1: SQLite queries, Q3 mods, MarioXP's 13,450
   CCA events, Another World's 64-thread bytecode VM). Plugins/patches become data;
   the cost is dispatch (below) and opaque static analysis.
2. **The interpreter floor is an implementation choice, not a constant: 6× spread.**
   SQLite VDBE 45 cycles/op vs ioquake3 QVM 7.2 cycles/instruction — same
   giant-switch architecture; the difference is *register-cached dispatch*
   (top-of-stack kept in r0/r1) vs memory re-read per op. Anyone building an
   interpreter (including agent tool-VMs) is choosing this number.
3. **The interpreter/JIT ratio of a real workload is bounded by its native:dispatch
   work ratio.** Synthetic compute loops: 10.3–18.5× (QVM), 10–22× (lab's own JS
   transfer test) — two independent engines agree. Real game frames: ~2–4.3×
   because ~1,289 mode-independent native-boundary traps/frame dilute dispatch.
   Corollary: the closer a workload lives to the C boundary, the less a JIT pays.
4. **Interpreter and JIT of the same engine are not bit-equivalent.** ioquake3's
   x86 JIT emits x87 float ops (80-bit intermediates, `fld/fmul/fistp`), the
   interpreter's C path is SSE (32-bit) → measured 0.3% syscall drift (all `sin`).
   Deterministic replay/lockstep against a JIT is unsound at FP granularity —
   pin the arithmetic (single FP implementation or fixed-point) if you need replay.
   *This criterion is not in any "interpret vs compile" checklist; it is now measured.*
5. **Frame scheduling discipline beats convenience defaults, measurably.** The
   TH04-derived patterns (M-2..M-11): slot pools (0 vs 248K allocations),
   work budgets (8 ms vs 49.8 s lag), deterministic replay (byte-identical vs
   never-replayable), deferred dispatch, zone allocation, LUT trig, index-linked
   lists, procedural-from-seeds. Measured on a 2026 stack in transfer tests.
6. **Budget disciplines are resource-agnostic; the port is re-deriving the unit.**
   TH04's pool/budget/step-down disciplines port from CPU/frame/slots to
   tokens/rate-limits (M-12, transfer-tested, now with a network-pathology
   layer): 100% completion vs 29 starved, runaway waste 18% of spend → 0,
   961k rate-limit rejections → 0, at identical quota-bound p99 lag. The port's
   real work is the four break-points (leased quotas, money-vs-time quality
   ladders, determinism asymmetry, silent truncation) — recorded in
   `catalog/mechanisms/M-12-budget-portability.md`.
6c. **The capacity question has two numbers, and the closed form only prices
   one.** Erlang's queueing math turns "how many concurrent calls do I need?"
   into arithmetic — and it is accurate for Poisson arrivals (validated here:
   max |rel.err| **5.1 %** against a simulation). But real agent traffic is not
   Poisson: measured on this machine's own traffic (38,513 calls, 29,852
   bursts), the count-variance inflation is **κ = 1.47** (stable across a 40×
   range of burst-grouping windows), which makes the wait **3.9× the Poisson
   answer** (the closed form answers **3.6× too low**) and leaves a plan built on the closed form **up to 2 circuits short**
   — worst exactly where the SLO is tightest. The classical compound-Poisson
   batch correction does **not** transfer (it over-corrects ~6.3×; it is
   calibrated for single-server M^X/G/1). So the product ships a *measured*
   burst factor and two numbers — circuits AND token quota. M-13.
6b. **Disciplines are not substitutes; each buys a different thing.**
   Decomposition on the same workload: the **per-task budget** stops runaway
   *spend* (563,356 → 0 tok) and AIMD alone does not (82,771 tok still burned);
   a **lease** avoids *discovery* (0 rejections vs AIMD's 600) while AIMD
   matches it on completion (180/180) and cost ($5.97 vs $5.99); **jitter**
   bounds the thundering herd (naive synchronized 192 retries in one instant
   vs 1–2). Porting an analogy wholesale would have hidden this — AIMD was
   first implemented with a concurrency-only window and looked like a failure
   (115/180) until it was ported faithfully (TCP's cwnd is a *byte* window).
7. **Lifecycle (not interpretation) dominates statement cost.** SQLite point query:
   77% of cycles are `Transaction`+`Halt` lifecycle, ~3% interpretation; WAL mode's
   win is a −66% `Transaction` opcode delta, and the 45-cycle floor is unchanged.
   Journaling, not interpretation, is the cost knob.

## 3. Technical findings per target (one row each, with reuse value)

| target | finding (class) | durable? |
|---|---|---|
| **touhou-th04-th05** | timed-VM discipline; self-mutating dispatch; `.STD` bytecode; slot pools & budgets (M-2/M-3/M-11) — `measured` via transfer tests | high |
| **marioxp** | CCA event format decoded (13,450 events, 0 leftovers); behavior-as-data at Click&Create scale (M-1) | medium-high |
| **another-world** | entire game as bytecode, 64 threads/frame, opcode-bits-as-draw-params (M-1) | medium |
| **rct (T5A–T5D)** | informed-reconstruction findings, class `restated` — re-anchor against the original binary still pending | low (until re-anchored) |
| **sqlite** | dispatch floor 45 cyc/op; lifecycle 77% of a point query; WAL −66% `Transaction`; profile grammar pinned; parser TDD'd (`measured`) | high |
| **qvm (4 phases)** | floor 7.2 cyc/instr; JIT ratio 10–19× synthetic / ~2–4× real; INIT vs steady-state asymmetry (prep 2.4× cheaper interpreted, but JIT'd image *smaller* than the 4×-expanded interpreter image); QVM VER1 format forensics; FP divergence | high (first two) / medium (rest) |
| **doom, elite** | parked (README only) — no findings yet | — |

## 4. Blunt usefulness audit (the verdicts, in the repo where they belong)

- **QVM target: ~⅓ durable.** The FP-equivalence finding and the 6× dispatch-floor
  contrast earn their place. Most of the token spend was one-off harness plumbing
  (stub bring-up, crash archaeology, q3asm quirks) with near-zero knowledge yield
  and low reuse beyond this exact target. In hindsight: the target should have
  stopped after dispatch floor + FP divergence (~⅓ of the work) and moved to the
  RCT2 re-anchor, which holds the actual open question.
- **Corroboration ≠ new knowledge.** The 10–22× interpreter tax already existed in
  the lab's own transfer test; QVM corroborated it. Catalog hygiene, not a new card.
- **Published-then-corrected cost:** the empty-HUD 4.3× frame ratio was published
  before the honest workload was measured (snapshot-retry loops inflated it →
  corrected to ~2×). Process rule adopted: **measure the real workload before
  publishing any intermediate number.**
- **The lab's compounding mechanism works:** findings are files (not chat), classes
  are explicit, and corrections land in the same chain (DECISION doc carries three
  dated upgrades, each superseding the last).

## 4b. Rules added from external review (2026-11-13)

Full log with per-point dispositions: `docs/CRITICISM-LOG-2026-11-13.md`.

- Bench headers must state baseline competence and metric semantics — M-5's
  "99.6s" headline was a run-length artifact (naive lag grows linearly at
  0.996 s-lag/s; the TH04 law is horizon-invariant ~17ms). The finding is the
  contrast: growth rate vs bounded steady state.
- Determinism claims name their matrix: M-4/M-9 evidence is single-host under
  machine-load jitter variation; the cross-platform matrix is untested and
  named as such.
- The determinism SKU is engine-controlled systems (games, backtesting, sims).
  LLM batch nondeterminism is a different mechanism (batch-invariant kernels,
  open source) — our x87/SSE finding is interpreter-vs-JIT within one engine,
  measured by syscall drift. For LLM traces, the lab's replayable object is the
  orchestration trace (budget/scheduling decisions).
- Product wedge: counterfactual capacity proof, measurement-first (M-12 bench
  now prints required-quota/finish-time/lever trade-offs; first product is a
  simulator-plus-profiler against customer traces, runtime later).
- "1998's mistakes" framing retired: retry storms are established distributed-
  systems failures; the honest line is that the agent layer rebuilt them without
  the operational discipline — and the lab measures what that discipline is worth.


## 5. Open questions carried forward

- RCT2 re-anchor against the original binary (deferred twice; the one standing
  open question on a shipped target).
- doom / elite parked: do they earn a probe, or get cut? Decide against the
  usefulness bar above, not against target count.
- QVM: parked at full trap layer. Remaining unknowns (qagame/ui under stubs,
  64-player scene, real GL back-end) are recorded in
  `targets/qvm/findings-openarena-full.md` and are **not** recommended work.
