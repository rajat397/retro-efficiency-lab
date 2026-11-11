# TIDE — a Tiny IDE built from reverse-engineered 1990s disciplines

A terminal IDE whose core is not "another editor": every structural decision
is a **mechanism extracted from real 1990s binaries** (TH04, Doom, Duke3D, RCT2
— see [retro-efficiency-lab](https://github.com/rajat397/retro-efficiency-lab)),
transfer-tested on modern stacks, and applied where it earns its keep.

Zero runtime dependencies. Node ≥ 18. ~30 KB of source.

```sh
node tide.mjs            # run the TUI
node test.mjs            # 14 headless verification tests
node bench.mjs           # mechanism receipts, measured on the real core
node tide.mjs --recover .tide-session.log   # crash recovery from the command log
```

## The five disciplines, and what they buy you here

| Discipline (origin) | In TIDE | Receipt |
|---|---|---|
| **M-2 fixed slot pools** (TH04's 440×26 B bullet pool, 1998) | buffers, lines, search hits, undo entries all live in preallocated `Int32Array` pools with a flag machine | hot path (cursor moves, search ticks): **0 structural allocations** |
| **M-10 index-linked membership lists** (Build 1996 / RCT2 2002) | line tables are `next`/`prev` index chains inside line slots; buffer LRU likewise | search walks **only the target buffer's lines** — 3.7× vs naive full-slot scan in the bench |
| **M-3 deferred application** (TH04 `checkThreadRequests` / Another World 1991) | every mutation is a *request*; `tickFrame()` applies them at the frame boundary | cascades cannot corrupt mid-frame state; the status bar shows pending requests |
| **M-4 replay determinism** (Doom demos 1993, TH04 `REC<DEMO_N>`) | the command log *is* the state: allocator decisions are recorded too | same log → byte-identical hash on a fresh core; **undo/redo are replay**, and **crash recovery is replay of the log tail** — quit-without-saving is recoverable by design |
| **M-5 measured slowdown** (TH04's `simSpeed` control law) | search is budgeted per tick (4,096 lines/tick, 256-hit ring) | 65k-line search: **~1.3 ms/frame**, input stays live; progress degrades, latency does not |

The editor core is deterministic by construction: **the only mutation
entrypoint is `apply(cmd)`**, and every command (including the allocator's
slot choices) is logged. That one rule is what makes undo, redo, recovery and
replay all the same mechanism.

## Keys

Normal mode: `h/j/k/l` move · `i` insert · `a` append · `o` open line ·
`x` delete char · `dd` delete line · `u` undo · `Ctrl-R` redo ·
`/` search (live, budgeted) · `n` next hit · `0`/`$` line ends ·
`g`/`G` top/bottom · `Ctrl-O` open file · `Ctrl-S` save ·
`Ctrl-P`/`Ctrl-N` cycle buffers (LRU order) · `Ctrl-Q` quit.

## Honest limits (v0.1)

- Content is stored as JS strings by slot — per-edit string allocation still
  happens (JS necessity); the *structural* state is the pooled part, and the
  claim is scoped to it.
- Single pane; buffer cycling instead of splits. Splits are a next step
  (they compose cleanly with the M-10 lists).
- Search is substring-only; no regex yet.
- The TUI is raw-ANSI and tested headlessly (core) — the shell itself has
  had only manual smoke testing; report terminal quirks in issues.

## Repository map

```
core.mjs      EditorCore: pools, index-linked lists, command log, budgets
session.mjs   high-level editing ops (keys/tests drive this)
ui.mjs        TUI shell (keys → requests; diff renderer)
tide.mjs      entry: TUI / --recover / --script (headless CI/demo)
test.mjs      14 verification tests (undo⇄redo, replay, recovery, bounds)
bench.mjs     4 mechanism receipts on the real core
```

MIT license.
