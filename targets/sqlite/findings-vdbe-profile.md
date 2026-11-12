# Findings — VDBE interpreter cost, MEASURED (T6.1 upgrade, 2026-11-12)

**Depth class**: measured (repro below; verified per the methodology depth bar).

## How (per probe contract)

Built SQLite from the official source with its built-in VDBE profiler
(`gcc -O2 -DVDBE_PROFILE ... sqlite3.c shell.c`; the amalgamation required
one local patch: the profile-reset loop declares `i` only under
SQLITE_DEBUG — upstream build bug under `-DVDBE_PROFILE` without it,
patched as `i0` locally). Workload: 10k-row table with index; 200 runs of
an index point query; per-opcycle profile captured in `vdbe_profile.out`
(1,000 statements — includes the CLI's own internal schema queries).

**Repro**: `/mnt/data/opt/sqlite/bld/sqlite3-prof /tmp/opencode/lab-big.db "SELECT val FROM t1 WHERE n=42 AND id<9000;"` with cwd containing the profile output; aggregate via the script in this file's history.

## The numbers (measured, hardware cycles)

| Op | Execs | Avg cycles/exec | Meaning |
|---|---|---|---|
| **Noop** | 400 | **45** | pure interpreter dispatch+loop floor |
| Column | 23,000 | 68 | most-executed op, ~1.5× the floor |
| Next | 19,400 | 9 | inner loop step |
| SeekGE | 200 | 12,179 | real B-tree work |
| OpenRead | 1,000 | 788 | cursor setup |
| **Transaction** | 800 | **14,622** | **statement lifecycle — the dominant cost** |
| Halt | 600 | 8,292 | teardown |

A full point-query program: 14 ops, ~60k hw cycles total — of which
**~750 cycles (~3%) are interpretation** (14 ops × 45-cycle floor + Column
work) and **~46k cycles (~77%) are Transaction+Halt lifecycle** (journal
handles, locking, statement reset).

## The unobvious finding

**"Interpreted" is not where SQLite's cost lives.** The VDBE dispatch
floor is 45 hardware cycles/op — roughly one modern branch-predictor
miss. Even the most-executed op (Column, 23k execs) runs at 68 cycles,
within ~1.5× of the floor. The dominant cost of an index point query is
the **transaction lifecycle** (14.6k cycles/op × Transaction+Halt), which
is I/O-adjacent compiled C, not the bytecode VM.

This upgrades the decision doc's rule with hardware numbers: the M-1
interpreter tax (10–22× on V8) measured REPLACEMENT of compiled work; the
SQLite measurement shows the absolute floor of interpretation is negligible
against any real work sharing the statement. Interpret-when-behaviors-vary
is even cheaper than the V8 numbers suggested.

## Verified depth

- sqlite3.c amalgamation upstream bug found and patched locally (undeclared
  `i` under `-DVDBE_PROFILE` without SQLITE_DEBUG) — found by compiling,
  not by reading about it.
- Define-name mismatch caught (`SQLITE_VDBE_PROFILE` vs `VDBE_PROFILE` —
  the Makefile silently accepted both; `strings` on the binary exposed it).
- Profile validated: the 2nd identical statement shows all-zero counts
  (the profile-reset patch working; nExec/nCycle reset per statement).
