# Methodology

## The extraction loop (per target)

```
scope → probe → read → extract → record-unknowns
```

1. **Scope.** REA inventory: modules, functions, strings, segments. Identify core
   subsystems (game loop, memory mgmt, data tables). Write the *per-target question
   list* (3–5 questions) before diving.
2. **Probe.** Pick the 3–5 functions that handle allocation, storage, per-frame work.
3. **Read.** REA pseudocode + assembly; cross-validate against any public
   reconstruction (do not fork it — read it, cite it, diff conclusions).
4. **Extract.** Write evidence cards (format below).
5. **Record unknowns.** REA limitations and unresolved questions become the backlog.

## Evidence card format

```markdown
### M-<n> <Mechanism name> (<family>)

**Mechanism.** <one sentence naming the structural choice>
**Witnesses.** <target(s), file + function names / data structures>
**Evidence.** <REA evidence IDs, pseudocode excerpts, measurements>
**Generalization.** <how a modern developer applies it on another stack>
**Costs.** <what it gives up; conditions under which it applies>
**Status.** single-witness | cataloged | proven
```

Families: `determinism` · `zero-alloc` · `data-as-program` · `procedural` ·
`streaming` · `format` · `lut`.

## Quality gates

- **single-witness** — extracted once, evidence attached.
- **cataloged** — observed in ≥2 targets; card records both witnesses and their diffs.
- **proven** — reimplemented as a ~200-line sketch on a modern stack (Rust/TS/WASM),
  benchmarked vs a naive version: memory, cold-start, frame time. Numbers or it didn't
  happen.

## Tooling

- REA MCP (`rea_*`) for native analysis; REA CLI for batch/binary ops.
- Public reconstructions: read as cross-reference, never fork to silence errors.
- Sessions produce dated logs under `sessions/`; decisions go to `docs/decisions.md`.

## Anti-nostalgia guards

- Survivorship bias: we sample reconstructor-approved survivors. The **costs** field
  and multi-witness rule are the counterweights.
- "Old software was also bad" is assumed true until a mechanism card says otherwise
  with evidence.
