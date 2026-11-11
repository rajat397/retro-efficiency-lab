# Transfer test — M-7 fnptr composition: data-driven state actions vs switch

**Claim tested.** Doom's mobj states are data rows whose `action` field is a
function pointer (p_enemy.c); TH04 runs the same shape. Behaviors compose by
assignment in data; the dispatcher is never edited. The transfer question:
what does function-table dispatch cost on a modern JIT stack, and does the
composition property survive?

## Results (Node 22, 20M transitions × 100 states)

| Variant | ns/transition | Notes |
|---|---|---|
| 100-case switch (fair control, generated module) | 60.1 | every state its own case |
| fnptr table (100 closures) | **38.6** | −36% vs control |
| extensibility | — | 101st behavior attached as `actions[100] = fn`; dispatcher untouched |
| replay of composed machine | — | behavior-sequence hash **IDENTICAL** |

Arithmetic cross-check: control and table produce identical accumulators
(`406949378`), so the comparison is like-for-like.

## Verdict

**Proven.** Against the fair control, the fnptr table is *faster* on this
stack — the 100-arm switch does not become a free jump table in V8 (caveat
recorded: the control lives in a generated module, so V8 may tier it
differently than inlined code). The data-driven shape is therefore free to
adopt — and the properties it buys (states as data rows, behaviors assignable
at runtime without touching the dispatcher, replay-identical composition)
hold exactly as in Doom.

**Cost recorded:** a polymorphic call site through 100 closures is the
mechanism's real shape; on engines without JIT (embedded interpreters) the
overhead picture can invert — the card's costs field covers that.

## Methodology note

Node 22.23's default TypeScript stripping breaks multi-line `new Function`
bodies, so the fair switch control is generated as a sibling module
(`.gen/switch100.mjs`) and imported. An earlier 6-case switch control was
unfair (95 states lumped into one arm) and was replaced.

Reproduce: `node bench.mjs`
