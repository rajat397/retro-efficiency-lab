// M-12 transfer test — agent-fleet budgets vs naive loop (deterministic DES).
// See bench.mjs for the full model. This README is the short form.

# M-12 transfer test: budget portability (TH04 → agent fleet)

Simulated provider (8 concurrent / 15,000→7,500 TPM, halving at minute 1),
200 tasks (20 runaway agents that never converge), virtual clock, metered
metrics — no LLM calls, no network.

**Network pathology layer** (added for the deciding experiment): latency
jitter 0–60 ms · slow tail 2% (6,000–18,000 ms) · client-side timeout 2,000 ms
(tokens still billed — the caller gave up, the bill grew) · 5xx partial failures
1%. The pathology is a **deterministic tape**: draw *N* is a pure function of
(seed, *N*), so every runtime meets the same pathology for the same
provider-call index and the comparison isolates discipline, not luck.

Four runtimes, same task list, same provider, same tape:

| metric | naive | budgeted | aimd | aimd_noBudget |
|---|---|---|---|---|
| real tasks completed | 151/180 | **180/180** | **180/180** | 177/180 |
| runaway agents stopped | 0 | 20 | 20 | 0 |
| tokens total | 3,314,928 | 2,992,694 | 2,985,205 | 3,047,059 |
| tokens burned past budget | 563,356 | **0** | **0** | 82,771 |
| 429 rate-limit rejections | 961,375 | **0** | 600 | 612 |
| client timeouts | 37 | 33 | 33 | 34 |
| 5xx partial failures | 19 | 16 | 16 | 16 |
| peak synchronized retries | **192** | 1 | 2 | 2 |
| $ spent | $6.63 | $5.99 | $5.97 | $6.09 |

Runtimes: `naive` (no concurrency discipline, no per-task budget, exponential
backoff with **no jitter**) · `budgeted` (M-2 call pool leased to provider
concurrency, M-11 per-task turn budget, leased token bucket, M-5 one-time
step-down, FIFO admission) · `aimd` (Jacobson AIMD with a *learned* window
instead of a lease, plus the M-11 budget) · `aimd_noBudget` (AIMD alone — the
control that isolates what AIMD contributes).

## What each discipline actually contributes

1. **The M-11 per-task budget is what stops runaway *spend*** (563,356 → 0 tok).
   AIMD alone does **not** — `aimd_noBudget` still burns 82,771 tok past budget.
   AIMD bounds *concurrency*, not per-task spend. The earlier revision of this
   bench reported "waste 0" for a runtime that had no budget: an accounting
   artifact, not a measurement. Fixed; the number above is now counted for
   every runtime.
2. **A lease avoids discovery; AIMD must pay for it.** `budgeted` takes 0
   rejections (the provider cooperates); `aimd` takes ~600 probes to learn the
   same quota and still reaches 180/180 at the same cost ($5.97 vs $5.99).
3. **Without jitter, retries synchronize.** `naive` peaked at **192 retries in
   a single virtual instant**; the disciplined runtimes peaked at 1–2. This is
   the thundering-herd mechanism, measured rather than asserted.
4. **AIMD needs the right lever.** An AIMD with only a concurrency window
   thrashes against a *token-rate* limit (measured: 735,649 rejections, 115/180
   completed). TCP's congestion window is a **byte** window, so the faithful
   port carries a token window as well; with both, AIMD converges. Two
   implementation rules had to be honored for the port to work at all, both
   measured as failures first:
   - the window must not shrink below one segment (MSS floor) — otherwise a
     single oversized call at the head of the queue deadlocks admission
     (measured: 0/180 completed);
   - additive increase must be ACK-clocked (one segment per ACK), not a small
     fixed constant — a fixed constant was ~40× too slow and the window never
     converged inside the horizon (measured: 73/180 completed).

Oracle: the orchestration trace (every scheduling/budget/retry decision, in
order) is FNV-1a hashed **per runtime** — all four replay byte-identically
across repeated runs. 3 seeds; per-seed workload hashes differ by design.

Mechanisms exercised: M-2 (call pool), M-11 (per-task turn budget), M-5
(step-down on external quota change), the leased token bucket (card break-point
1), and AIMD (Jacobson 1988) as a *provider-independent* admission discipline.
Break-points 2–4 (quality ladder, real-LLM determinism, context eviction)
remain unexercised — recorded in the card.

Run: `node bench.mjs`

## Validating against a real (mock) provider

A simulation can be self-consistent and still wrong about the mechanism it
claims to model. `mock-provider.mjs` is an OpenAI-compatible peer that injects
controlled pathology (latency jitter, 429s, 5xx, timeouts, a TPM ceiling, a
concurrency ceiling) and logs what the harness actually sent.
`validate-mock.mjs` spawns its own peer and drives it with two clients:

```
node validate-mock.mjs 8
```

| metric | naive (blind) | leased (self-capped) |
|---|---|---|
| 429 rejections | 292 | **0** |
| peak retries in flight at once | 8 | **0** |
| peak retries dispatched in one millisecond | 7 | **0** |
| elapsed | **51,342 ms** | **399 ms** |

Both claims under test **confirmed** against a live peer: an un-jittered retry
storm forms (8 retries in flight at once, 7 dispatched in the same
millisecond) while a self-capped client is never rejected (0 vs 292) — and the
storm cost **129× the wall-clock** (51.3 s vs 0.4 s).

**Scope, honestly.** The live peer validates the *mechanism*, not the bench's
absolute counts. The bench's "192 retries at one instant" is a *scheduling*
herd (how many retries are launched into the queue together); the live figure
is a *concurrency* herd, and the peer's own concurrency ceiling physically
bounds it to 8. The absolute rejection counts (961,375) depend on the bench's
quota model, not on the peer. Two implementation notes that cost a wrong
first result, recorded because both would silently void the test:
- the peer must count in-flight at **arrival**, before reading the body, or
  overlapping requests are invisible;
- the peer needs real latency, or requests complete faster than sockets are
  accepted and no overlap occurs (measured: 0 ms jitter → the peer never saw
  two requests in flight; 300 ms → it saw 9).
- Node's global `fetch` pooled the calls into a serial chain; the validation
  client uses raw `http` with an explicit socket pool.

The mock provider also doubles as the instrument that diagnosed the
session-crash of 2026-11-13: it logs the exact tool count and schema bytes the
harness sends (236 tools / 816 KB / 281,131 input tokens before the fix).
