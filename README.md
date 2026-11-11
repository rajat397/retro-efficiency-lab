# Retro Efficiency Lab

Reverse engineering small-budget software (games and apps of the 80s–2000s) to extract
**transferable efficiency mechanisms** for use on modern stacks.

**Thesis:** the REA-community wave of reverse engineering old, complex, ultra-efficient
games showed that deep systems were built to run in kilobytes and megabytes. We believe
many of those mechanisms are *structural disciplines* modern software abandoned when RAM
got cheap. This lab rediscovers them with evidence, generalizes them, and tests whether
they survive on modern stacks.

**Method:** REA (reverse-engineer-anything MCP/CLI) + opencode agents + public
reconstructions as cross-references. Every claim carries evidence. Nothing ships without
a transfer test with numbers.

## Structure

| Path | Purpose |
|---|---|
| `docs/decisions.md` | Decision log (append-only) |
| `docs/methodology.md` | The extraction loop, evidence-card format, quality gates |
| `catalog/` | The learnings catalog — mechanism cards, organized by family |
| `targets/` | Per-target working notes, one folder per game/app |
| `sessions/` | Dated session logs: discussions, findings, open threads |

## Status

- **Target 0 (worked example): MarioXP** — complete. Proves the pipeline end-to-end.
- **Target 1: Touhou TH04/TH05 (PC-98)** — in progress.
- Full slate and ordering: `targets/README.md`.

## Rules

1. A learning is transferable only if it names a **mechanism**, generalizes beyond the
   original, and carries **evidence** (function/structure/measured behavior).
2. Every card states what the mechanism **costs** — honesty about tradeoffs is what
   separates this from nostalgia.
3. A mechanism isn't "cataloged" until it has **≥2 witnesses** across targets, and it
   isn't "proven" until it passes a **transfer test with numbers**.
