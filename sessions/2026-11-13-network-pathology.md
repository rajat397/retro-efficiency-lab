# Session 2026-11-13 — network-pathology layer + AIMD port (M-12), and a session-crash diagnosis

## Participants

User (rajat) + REA General (opencode agent).

## 0. Session-crash diagnosis (the reason this session started where it did)

The session resumed after a crash with an upstream error pasted by the user:

```
Upstream request failed: [invalid_value] Invalid value for 'tools': maximum number of items is 128.
```

and a report that the context window was sitting at ~313.9K against a 128K target.

**Root cause (one cause, both symptoms):** the REA MCP server advertises **207
tools** with **3,084 KB** of JSON Schema. Every request ships all of them.

Measured at the wire with a purpose-built OpenAI-compatible mock provider
(`/mnt/data/opt/mock-provider/server.mjs`, now committed as the transfer test's
`mock-provider.mjs`), which logs exactly what the harness sends:

| | before | after |
|---|---|---|
| tools sent in the request | **236** | **104** (native+web profile) |
| tool schema bytes | 816,092 | 172,793 |
| request bytes | 975,607 | 332,346 |
| real-provider input tokens | **281,131** | **80,534** |

Calibration runs (same workload, real provider): 207 tools → 281,131 input
tokens; all REA tools disabled → **45,639** (pure overhead: system prompt +
29 non-REA tools); the 5 heaviest tools alone → 196,904. So the tool schemas
were the dominant context term, and 236 > 128 was the crash.

**Fix (config-only).** opencode 1.18.35 has **no per-MCP tool filter**
(`McpLocalConfig` exposes only `type`, `command`, `cwd`, `environment`,
`enabled`, `timeout`) — but the **root `tools` map does filter MCP tools by
name** (verified: disabling 5 tools cut input by 84,227 tokens). Delivered:

- `/mnt/data/opt/rea-tool-profile/` — mission profiles (`native`, `web`,
  `android`, `debug`, `evidence`) + `apply.mjs` to switch between them.
- `~/.config/opencode/opencode.jsonc` now disables 114 of the 207 REA tools
  (native+web profile).

**Budget, measured not estimated:** non-REA tools = **29**, so the REA budget
under the upstream 128-item cap is **99**. Current profile uses 93 REA →
**122 tools total** (verified at the wire) and 80,534 input tokens, leaving
~47K of the 128K window for conversation. `native` alone (75 REA → 104 total,
67,205 tokens) is the safe fallback.

## 1. Network-pathology layer (the deciding experiment)

Extended the M-12 bench with a pathology layer: latency jitter (0–60 ms), a
slow tail (2% of calls at 6,000–18,000 ms), a client-side timeout (2,000 ms)
where **the tokens are still billed** (the caller gave up; the bill grew — the
failure the T8 finding shows OpenCode does not budget for), and 5xx partial
failures (1%).

The pathology is a **deterministic tape**: draw *N* is a pure function of
(seed, *N*), so every runtime meets the same pathology for the same
provider-call index. The comparison isolates discipline, not luck.

## 2. AIMD ported (Jacobson 1988) — and three ways the first port was wrong

A fourth runtime was added: `aimd` — a **learned** window (in-flight + token)
instead of a lease, plus the M-11 budget — and `aimd_noBudget` as its control.

The first port was wrong three times, each caught by measurement, not by
argument:

1. **Concurrency-only window.** TCP's congestion window is a **byte** window;
   a concurrency-only AIMD thrashes against a token-rate limit → measured
   **735,649 rejections, 115/180 completed**. The faithful port carries a
   token window too.
2. **No MSS floor.** The window shrank below a single call's size, and one
   oversized call at the head of the queue deadlocked admission → **0/180**.
   TCP never lets cwnd fall below one segment; same rule here.
3. **Additive increase not ACK-clocked.** Growing by a fixed constant was ~40×
   too slow to converge inside the horizon → **73/180**. One segment per ACK
   fixed it.

Plus a **queue bug**: on the provider-429 path the task was re-queued without
being removed from `pending`, so it existed twice, was admitted twice, and
double-counted completions (measured 199/180 real tasks).

## 3. Honesty correction to the lab's own earlier claim

The previous revision of the bench printed `waste 0 (M-11 budget shared)` for
an AIMD runtime that had **no M-11 budget** — `runawayWaste` was only
accumulated for the naive runtime, so the number was an **accounting artifact
presented as a measurement**. Waste is now counted for every runtime, which
is what exposed the real decomposition.

## 4. Result — four runtimes, same tasks, same provider, same tape

| metric | naive | budgeted | aimd | aimd_noBudget |
|---|---|---|---|---|
| real tasks completed | 151/180 | **180/180** | **180/180** | 177/180 |
| runaway agents stopped | 0 | 20 | 20 | 0 |
| tokens burned past budget | 563,356 | **0** | **0** | 82,771 |
| 429 rate-limit rejections | 961,375 | **0** | 600 | 612 |
| client timeouts | 37 | 33 | 33 | 34 |
| 5xx partial failures | 19 | 16 | 16 | 16 |
| peak synchronized retries | **192** | 1 | 2 | 2 |
| $ spent | $6.63 | $5.99 | $5.97 | $6.09 |

**Three findings:**

- **The per-task budget stops runaway *spend*; AIMD alone does not.**
  `aimd_noBudget` still burns 82,771 tok past budget; `aimd` (AIMD + budget)
  burns 0. AIMD bounds *concurrency*, not per-task spend. The two disciplines
  are not substitutes.
- **A lease avoids discovery; AIMD must pay for it.** The leased bucket takes
  0 rejections (the provider cooperates); AIMD takes ~600 probes to learn the
  same quota and still reaches 180/180 at the same cost ($5.97 vs $5.99). AIMD
  is the fallback for a quota you cannot observe or lease.
- **Without jitter, retries synchronize.** Naive peaked at **192 retries in one
  virtual instant**; disciplined runtimes at 1–2. The thundering herd, counted
  rather than asserted.

Oracle: the orchestration trace is hashed **per runtime** — all four replay
byte-identically across repeated runs, and across separate process
invocations (identical output hash).

## 5. Files

- `catalog/transfer-tests/M-12-budget-portability/bench.mjs` — pathology layer,
  4 runtimes, MSS floor, ACK-clocking, queue fix, per-mode trace oracle.
- `catalog/transfer-tests/M-12-budget-portability/README.md` — card, rewritten.
- `catalog/transfer-tests/M-12-budget-portability/mock-provider.mjs` — the
  OpenAI-compatible mock used to measure what the harness actually sends.
- `catalog/mechanisms/M-12-budget-portability.md` — status + scope honesty.
- `docs/ANALOGY-MAP.md` — §Results written (was a stub); AIMD spec corrected.
- `docs/LEARNINGS.md` — M-12 numbers updated; new learning 6b (disciplines
  are not substitutes).

## Open

- The mock provider exists but the bench's predicted rejection counts have
  **not yet been validated against a live client** — the validation run is the
  obvious next step.
- Erlang-style capacity planning for bursty fan-out traffic (analogy #6) is
  still a linear estimate; the math upgrade is pending.
- Cross-platform determinism matrix (CI) — still open.
- Real traffic traces — still needs a partner.
