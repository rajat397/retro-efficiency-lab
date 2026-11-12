# Findings — SQLite VDBE: queries-as-data in production (T6.1, 2026-11-12)

Artifact: `/tmp/opencode/lab-catalog.db` (created for this probe; 3 tables,
index, seeded rows — a real SQLite file). Queries probed via Node 22's
`node:sqlite` EXPLAIN. Note: `rea_inspect_sqlite_database` requires Node
24.15+ (DatabaseSync.limits); this environment runs 22.23 — tool-backed
inspection deferred, EXPLAIN dumps are the evidence here.

## The decision doc's hybrid claim, confirmed in production code

`sqlite3VdbeExec` (`src/vdbe.c:903`) is a single interpreter loop over ~200
opcode arms. Three EXPLAIN dumps of real queries against the artifact:

**Point query** — `SELECT status, family FROM mechanisms WHERE id = ?` — **15 ops**:
`Init → OpenRead → OpenRead → Variable → IsNull → Affinity → SeekGE → IdxGT
→ DeferredSeek → Column ×2 → ResultRow → Halt (+ Transaction, Goto)`.
Program shape: open table + index, seek loop, emit. The *hot* work
(B-tree seek, page-cache reads) is inside compiled opcode
implementations; the *control flow* of the query is the data program.

**Join** — nested-loop join with an index-driven inner seek — **20 ops**:
`Rewind → Column → IsNull → SeekGE/IdxGT/DeferredSeek → Ne → ResultRow → Next`.
Outer loop = `Rewind`/`Next` pair; inner loop = index seek. Classic
query-plan shape, expressed entirely as a data program.

**Aggregate** — `GROUP BY ... ORDER BY` — **49 ops** and the decisive
finding: the VDBE program uses **subroutines** — `Gosub ×4 / Return ×4`
with `Integer/Null` prologue setup, `SorterOpen → SorterInsert →
SorterSort → SorterNext` for the grouping, `AggStep/AggFinal` for
aggregation. A 1990s-style bytecode VM with call/return inside the
program — structurally identical in spirit to TH04's event programs and
Another World's threads, running on the most-deployed DB in history.

## What this proves for M-1 / the decision doc

1. **The hybrid wins at planetary scale**: queries (the frequently-changing,
   unauthored-by-programmers part) are data programs; B-tree/page-cache
   inner loops are compiled C. No compiler for SQL→machine-code in the
   core — interpretation tax accepted at ~15–49 ops per query.
2. **The tax math holds**: a point query = 15 VDBE ops; at the M-1-measured
   interpreter tax that cost is trivial per query vs the compiled B-tree
   work inside each op. SQL queries are the "cold control" case exactly.
3. **Programs carry structure**: subroutines (Gosub/Return), loops
   (Rewind/Next), and parameterized inputs (Variable) — event-program VMs
   and query engines converge on the same shape.
4. **Bounded memory adjacent**: the programs run against the bounded page
   cache (PCache-local bulk allocation, `pcache1.c:63,133`,
   `SQLITE_DEFAULT_CACHE_SIZE` at `sqliteLimit.h:160`) — M-2 family.

## Anchors

- `src/vdbe.c:903` — `sqlite3VdbeExec` interpreter entry
- `src/vdbe.c` — ~200 `case OP_*` arms (counted in probe)
- `src/pcache1.c:63,133` — bulk local allocation of page slots
- `src/sqliteLimit.h:160` — `SQLITE_DEFAULT_CACHE_SIZE`
- `src/pager.c:934+` — `PAGER_JOURNALMODE_WAL` (M-4 family, T6.3 probe)
- EXPLAIN dumps above — executed against the artifact DB (Node 22 `node:sqlite`)

## UNANCHORED / deferred

- `rea_inspect_sqlite_database` tool-backed artifact evidence: requires
  Node 24.15+ runtime — deferred to a Node 26 environment.
- VDBE subroutine mechanics in vdbe.c internals (Gosub implementation
  line numbers) — next probe.
