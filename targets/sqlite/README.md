# Target 6 — SQLite (D. R. Hipp et al., 2000–)

Status: **opened** (initial findings 2026-11-12)

## Why this target

The most-deployed software on earth (every phone, browser, OS): a complete
ACID relational database in ~1 MB of C, famously efficient and famously
tested. It matches the lab's criteria (best-used, complex, technical,
efficient) and — decisively — **it ships a bytecode VM**, making it the
modern witness for the interpret-vs-compile decision (`docs/DECISION-interpret-vs-compile.md`).

Authority: official source (public domain), cloned to `/mnt/data/opt/sqlite`.

## Findings so far (source-anchored)

### 1. Queries are DATA — the VDBE (M-1's modern witness)

`sqlite3VdbeExec` (`src/vdbe.c:903`) interprets a compiled VDBE program —
~200 opcode arms (`case OP_*` in vdbe.c). SQL statements are compiled into
bytecode programs (data) and executed by one interpreter. The hot inner
loops (B-tree, page cache) are plain compiled C. This is exactly the
hybrid shape the decision doc prescribes: hot path compiled, cold control
in data — in the most-used DB on earth, 25 years running.

### 2. Bounded memory pools (M-2 family)

Page cache: `pcache1.c` with **PCache-local bulk allocation**
(`pcache1.c:63,133` — `isBulkLocal`, "This page from bulk local storage"),
size bounded by `SQLITE_DEFAULT_CACHE_SIZE` (`sqliteLimit.h:160`). The
cache is a fixed pool of page slots, not per-page malloc.

### 3. Journal modes (determinism/recovery family)

`pager.c` `PAGER_JOURNALMODE_WAL` (`pager.c:934+`) — write-ahead logging as
a mode switch on the pager: the recovery/replay discipline (M-4 family)
exposed as a runtime-selectable strategy.

## Probe plan (mechanism-card mapping)

1. VDBE program shape → extend M-1's witness list (SQLite = witness #4:
   MarioXP, AW, TH04/TH05, SQLite) and validate the decision doc's hybrid
   claim against real op mixes (`EXPLAIN` dumps of common queries).
2. Page-cache eviction under budget → M-2/M-11 transfer-test parallels
   (bounded cache vs unbounded; the LRU/purge-tag shape).
3. WAL vs rollback-journal under concurrent readers/writers → M-4 family
   (deterministic recovery).
4. Using the lab's own `rea_inspect_sqlite_database` tool on real DBs to
   tie static findings to artifact evidence.
