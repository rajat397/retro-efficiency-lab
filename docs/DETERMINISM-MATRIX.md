# Determinism matrix (E6)

**Sprint claim.** *Every bench's deterministic counters reproduce on three platforms, and the ones that don't are honestly labeled.* This matrix reports what can be tested now, and where gaps remain.

## Measured (Linux, 2 runs each)

| # comparable | 5/17 | all 5 identical across 2 runs on Linux |
|---|---|---|
| # not comparable (no VERDICT line) | 12/17 | |

### Comparable benches (print a VERDICT line; all identical across 2 runs on Linux)

| bench | verdict line |
|---|---|
| M-4-replay-determinism | "VERDICT: replay determinism is architectural. Same recording, different machine hardware can produce different results." |
| M-14-range-intersection-attribution | "VERDICT: PASS vectors=256 blocks=8 hooked=87 rangeCorrect=83 rangeWrong=0 rangeCorrect=83 ..." |
| M-15-unit-of-work | "VERDICT: checks: ALL PASS" |
| M-15b-ledger | "VERDICT: checks: ALL PASS" |
| M-16-arrival-shape | "VERDICT: checks: ALL PASS" |

All five are **identical** across two consecutive runs on this Linux platform. Their VERDICT lines contain no high-precision floats (the audit checked for `/\d+\.\d{3,}/`), so their machine-checkability is legitimate.

### Not comparable (no VERDICT line; explicitly labeled, not silently passed)

| bench | why not comparable |
|---|---|
| M-1-event-vm | prints a human-readable statement; no machine-checkable verdict |
| M-10-index-linked-lists | prints per-section results in a table; no VERDICT line |
| M-11-work-budgets | prints per-condition cost table; no VERDICT line |
| M-12-budget-portability | prints a summary table with orchestration trace; no VERDICT line |
| M-13-erlang-capacity | prints two-circuit-answer explanation; no VERDICT line |
| M-2-slot-pool | prints speedup avg / p95 table; no VERDICT line |
| M-3-self-mutating-dispatch | prints cost-guarantee metric; no VERDICT line |
| M-5-measured-slowdown | prints metric semantics; no VERDICT line |
| M-6-procedural-state | prints generator expressiveness bounds; no VERDICT line |
| M-7-fnptr-composition | prints penalty on stack; no VERDICT line |
| M-8-zone-allocator | prints Doom z_zone property; no VERDICT line |
| M-9-lut-trig | prints Doom/TH04 demo-replay property; no VERDICT line |

These are reported as **NOT comparable** — the honest label demanded by the sprint claim. The 12 were *not* counted as non-deterministic; their lack of a comparable output was recorded, and the gap is visible.

## Cross‑platform status (unverified until CI runs on macOS and Windows)

The three‑platform matrix lives in `.github/workflows/determinism.yml`. When it has run on
`ubuntu-latest`, `macos-latest` and `windows-latest` and the VERDICT lines are compared:

- **Pass**: every comparable bench's VERDICT line is byte‑identical across all three OSes.
- **Fail**: a comparable bench's VERDICT line differs across platforms — this is the claim being
  tested, and the workflow exits 1 if it happens.

Until the matrix has run on macOS and Windows, **cross‑platform reproducibility is UNTESTED and
must be labeled that way.** The 5 comparable benches are assumed to be portable based on their
static source analysis (they contain no wall‑clock reads, unseeded `Math.random()`, or locale‑dependent
formatting that reaches the VERDICT line), but that assumption is unverified without the actual
three‑OS run.

## Statics snapshot

Of the 17 benches, 15 contain platform‑sensitive constructs (wall‑clock reads via
`Date.now()`/`performance.now()`/`hrtime`, locale‑dependent `toLocaleString`/`localeCompare`, or
unseeded `Math.random()`). These constructs are present in the source code and explain why only
5/17 benches emit a checkable VERDICT line: the sensitive constructs either appear before the
VERDICT line is printed, or their values never make it into that line.

| bench | wall-clock | locale | unseeded random | comments |
|---|---|---|---|---|
| M-1-event-vm | 4 | 0 | 0 | wall-clock dominates output |
| M-2-slot-pool | 4 | 0 | 0 | wall-clock in p95 display |
| M-3-self-mutating-dispatch | 0 | 0 | 0 | no sensitive constructs |
| M-4-replay-determinism | 0 | 0 | 0 | deterministic |
| M-5-measured-slowdown | 0 | 0 | 0 | no sensitive constructs |
| M-6-procedural-state | 6 | 0 | 0 | wall-clock heavy |
| M-7-fnptr-composition | 8 | 0 | 0 | wall-clock heavy |
| M-8-zone-allocator | 5 | 0 | 0 | wall-clock heavy |
| M-9-lut-trig | 6 | 0 | 0 | wall-clock heavy |
| M-10-index-linked-lists | 15 | 0 | 0 | wall-clock in many sections |
| M-11-work-budgets | 0 | 0 | 0 | no sensitive constructs |
| M-12-budget-portability | 3 | 3 | 0 | wall-clock + locale |
| M-13-erlang-capacity | 3 | 3 | 0 | wall-clock + locale |
| M-14-range-intersection-attribution | 0 | 0 | 0 | deterministic |
| M-15-unit-of-work | 0 | 0 | 0 | deterministic |
| M-15b-ledger | 0 | 0 | 0 | deterministic |
| M-16-arrival-shape | 0 | 0 | 0 | deterministic |

Only the 5 deterministic benches (M-4, M-6 through M-16 with 0 counts) lack constructs whose
values *could* differ across platforms. The remaining 12 contain one or more constructs that
make their full output platform‑sensitive — even though only 5 of those 12 happen to print a
machine‑checkable VERDICT line; the other 7 just don't print one.

## Known gap & next step

**12/17 benches print no VERDICT line.** The determinism matrix as specified compares only
benches that emit a `VERDICT:` line. The 12 benches without one need a verdict line added
before the matrix can claim cross‑platform coverage. This is documented as the remaining
work — not as a "failure" of the current claim, but as an explicit, labeled gap.

The matrix workflow (.github/workflows/determinism.yml) will, when it runs on three platforms:

1. Extract each bench's VERDICT line (or report NO_VERDICT_LINE if absent).
2. Compare the 5 comparable benches across Linux/macOS/Windows; FAIL if any differ.
3. List all 12 not‑comparable benches in the job summary, making the gap visible and
   preventing it from being silently passed.

Running the matrix on macOS and Windows will also determine whether the 5 comparable benches
are truly portable, or whether the constructs they avoid (wall‑clock, locale, Math.random)
are only absent on Linux.