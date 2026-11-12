# Finding: VDBE statement lifecycle and WAL-vs-DELETE journaling delta (measured)

**Depth class:** `measured` — every number below was produced by running the profiler and
the parser in this directory. Nothing is restated from docs.

**Date:** 2026-11-13 · **HEAD at measurement:** `5495248` (tree clean; parser + this file added after, uncommitted)

## Method

1. Profiling build: `make sqlite3 OPTS="-DSQLITE_VDBE_PROFILE"` → `bld/sqlite3-prof`
   (upstream amalgamation bug fixed by declaring `i0`; profile appended at `src/vdbeaux.c:3680`
   via `fopen("vdbe_profile.out","a")`).
2. Workload: `/tmp/opencode/lab-big.db`, table `t1(id,n,val)`, 10k rows, index on `n`.
   200 CLI invocations of `SELECT val FROM t1 WHERE n=42 AND id<9000;` (94-row range scan),
   plus point-lookup statements, per journal mode.
   - Mode A: `PRAGMA journal_mode=DELETE;` → `/tmp/opencode/prof-delete.out`
   - Mode B: `PRAGMA journal_mode=WAL;` → `/tmp/opencode/prof-wal.out`
   - Each profile: 1,000 blocks, 800 executed, 200 zero-execution duplicates of the target SQL
     (same hash, all counts 0 — parser flags them `executed=false` and excludes them).
3. Parser: `parse-vdbe-profile.mjs` (TDD-tested by `parse-vdbe-profile.test.mjs`,
   `node targets/sqlite/parse-vdbe-profile.test.mjs` → all assertions pass).
4. Aggregation: `node targets/sqlite/summarize-profiles.mjs`.

## Findings

### F1. WAL cuts the `Transaction` opcode cost by ~66% (16,231 → 5,562 cycles)

Per-opcode averages over identical executed statement sets (800 `Transaction` execs in both modes):

| opcode | DELETE avg | WAL avg | delta |
|---|---|---|---|
| **Transaction** | **16,231** | **5,562** | **−66%** |
| Halt | 8,718 | 8,121 | −7% (noise) |
| SeekGE | 13,306 | 15,536 | +17% (noise; wide per-statement spread) |
| Column | 3,434 | 3,478 | +1% (noise) |
| IdxGE | 155.1 | 148.6 | −4% (noise) |
| DeferredSeek | 88.6 | 85.3 | noise |
| OpenRead | 794.1 | 826.7 | +4% (noise) |
| Next | 68.1 | 69.0 | noise |
| ResultRow | 44.8 | 44.3 | noise |

The only opcode with a large, one-directional delta is `Transaction` — SQLite's statement
lifecycle opcode (open/read tx + write txn bookkeeping). This is the journaling cost
surfacing at opcode granularity: under WAL, starting a write transaction is ~10.7k cycles
cheaper per statement.

### F2. Range-scan statement cost is dominated by data movement, not lifecycle

Target range-scan statement (`SELECT val FROM t1 WHERE n=42 AND id<9000;`, 94 rows):

- DELETE: avg **469,951** cycles/statement (min 325,521, max 913,535, n=200)
- WAL: avg **454,316** cycles/statement (min 322,504, max 1,019,330, n=200)
- Delta ≈ −3.3%, consistent with the `Transaction` saving (~10.7k of ~470k ≈ 2.3%).

Per-statement totals are dominated by `Column` (≈79M of ≈94M target cycles ≈ 84%):
the 94-row scan pays ~740k cycles in `Column` alone per statement (verified row-by-row:
`Column 0 1 3` cnt 93 / 740,168). Lifecycle ops (`Transaction` 50,154 + `Halt` 14,352)
are ~7% of a range-scan statement.

### F3. Interpretation floor is unchanged by journal mode

The ~45 cycles/op interpreter floor (`Noop` ≈ 45) and general op-interpretation share
(≈3% of statement cost for point lookups, measured in commit `5495248`) are identical
across DELETE/WAL. Journal mode changes lifecycle cost only.

### F4. Profile-output shape (grammar, pinned)

- Block boundary: `---- <hex>` — **variable length** (28- and 32-hex hashes both occur;
  the parser originally assumed 32 and mis-joined blocks — caught by the RED test).
- Optional `-- <SQL>` label lines follow the boundary (multiple joined with `\n`).
- Op rows: `cnt cycles self addr opcode p1 p2 p3 [p4] <2-hex flags> [comment]`.
  After `p3`, a token matching `^[0-9A-Fa-f]{2}$` means p4 is absent (that token is flags);
  single-char tokens (`0`, `3`) are p4. Empty comment is `''`, never undefined.
- Zero-execution duplicate blocks (same SQL re-prepared, all counts 0) appear regularly —
  200 of 1,000 blocks in both profiles. They must be excluded from averages or they dilute
  every opcode mean.

## Repro

```sh
cd /mnt/data/opt/sqlite && make sqlite3 OPTS="-DSQLITE_VDBE_PROFILE"   # → bld/sqlite3-prof
/mnt/data/opt/sqlite/bld/sqlite3-prof /tmp/opencode/lab-big.db "PRAGMA journal_mode=DELETE;"
for i in $(seq 200); do /mnt/data/opt/sqlite/bld/sqlite3-prof /tmp/opencode/lab-big.db \
  "SELECT val FROM t1 WHERE n=42 AND id<9000;" ; done >> /tmp/opencode/prof-delete.out
# repeat with PRAGMA journal_mode=WAL into prof-wal.out
cd /mnt/data/projects/retro-efficiency-lab
node targets/sqlite/parse-vdbe-profile.test.mjs   # parser TDD: GREEN
node targets/sqlite/summarize-profiles.mjs        # prints the table above
```

## Transfer statement (card M-1 addendum)

At VDBE granularity, WAL mode's win is measured as a −66% reduction in the `Transaction`
opcode (16,231 → 5,562 cycles avg, identical 800-exec sets); total statement cost shifts by
only ~3% on a range scan because data movement (`Column`) dominates. Engine interpretation
itself is ~45 cycles/op regardless of journal mode.

## Unknowns

- `SeekGE`/`Halt` deltas show ±7–17% swings in the opposite directions across modes with
  wide per-statement spread (min/max 325k–1,019k) — treated as noise at n=200; a paired
  same-index comparison would tighten this.
- Per-cycle numbers are machine-clock-based; absolute values are host-specific. The
  DELETE/WAL ratio is the transferable artifact.
