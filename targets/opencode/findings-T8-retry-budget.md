> **Depth class**: measured (constants quoted verbatim from the shipped bundle;
> control-flow structure confirmed in the minified source; runtime behavior not
> executed)

# T8 Findings — OpenCode's shipping retry/budget discipline (REA, app.asar)

Target: `/opt/OpenCode/resources/app.asar` (OpenCode desktop, sha256
`5eb87aa8790328690c858d0c954ce5d7dae76055bc9945ad0bca7df709fd2089`, ~142 MB,
6,700 files). REA opened it (`ev_1e7e6461…`); the 32 MB server bundle
(`out/main/chunks/node-CRmY9MnM.js`) exhausts REA's analysis worker heap, so the
extracted bundle was analyzed at string/constant level (the JS equivalent of
`rea_list_strings`) with exact-quote evidence below. Extracted copy:
`/tmp/opencode/oc-asar/` (scratch).

## Why this target matters

OpenCode is a *shipping agent-era product* — exactly the class the M-12
mechanisms target. The question: **is a production agent runtime naive,
AIMD-like, or lease-like?** Answer measured below.

## 1. Three retry layers stack (two foreign SDKs + one app-level policy)

| layer | origin | policy |
|---|---|---|
| LLM SDK (OpenAI/Anthropic clients, bundled) | third-party SDK | `maxRetries ?? 2`; `shouldRetry`: 408/409/429/5xx or `x-should-retry` header; delay = `retry-after-ms`/`retry-after` header, else `min(0.5·2^n, 8s) × (1 − 0.25·rand)` |
| HTTP layer (got-style defaults) | third-party | `retries: 10, factor: 2, minTimeout: 1000, maxTimeout: ∞` (unbounded ceiling!) |
| **App session retry** (opencode's own) | **first-party, the one that matters** | quoted verbatim below |

The app passes `maxRetries: input.retries ?? 0` to the SDK (disabling SDK-level
retries) and runs its **own** session retry policy — measured constants:

```js
RETRY_MAX_RETRIES = 5
RETRY_INITIAL_DELAY = 2e3          // 2 s
RETRY_BACKOFF_FACTOR = 2           // exponential
RETRY_JITTER_FACTOR = 0.25         // ±25% jitter
RETRY_MAX_DELAY = 2147483647       // (when headers present: retry-after is honored up to this cap)
RETRY_MAX_DELAY_NO_HEADERS = 3e4   // 30 s ceiling when no server guidance
```

`delay(attempt, error)`: honors `retry-after-ms`, then `retry-after` (seconds,
then HTTP-date), else `2s × 2^(attempt−1) × (1 + 0.25·rand)`, capped at 30 s
(no headers) / 2^31 ms (headers).

## 2. Retryability: status patterns + hard budget stops

```js
RETRYABLE_MESSAGE_PATTERNS = [
  /429|500|502|503|504|524/i,
  /rate increased too quickly|rate limit|rate-limit|rate_limit|too many requests/i,
  /overloaded|service unavailable|…|provider returned error|…/i,
  /terminated|fetch failed|failed to fetch|network[-_ ]…/i ]
```

**Budget-relevant exclusions, measured:**
- `ContextOverflowError` is **never retried** (`retryable()` returns early) —
  context exhaustion is a hard stop, matching M-11's budget-kill semantics.
- `FreeUsageLimitError` is detected from the response body and converted into a
  **user-facing upsell message with a computed reset countdown** (`days/hours/
  minutes` from `retry-after`) — spend-limit handling, not retry handling.

## 3. Context budget discipline (the M-11/M-12 analogue, shipped)

- `isOverflow()` compares total tokens (incl. cache read/write) against
  `usable(context) = context − reserved`, with `COMPACTION_BUFFER = 20000` and
  `preserve_recent_tokens ∈ [20…15]k ≈ 25%` defaults — the **context window is
  budgeted with explicit eviction (compaction), not silently truncated**
  (M-12 break-point 4 addressed in production).
- Compaction runs mid-session (`needsCompaction → summarize`) — the
  slot-reuse analogue.

## 4. What is MISSING (the finding against the naive side)

Measured absences in the shipped bundle:
- **No token/dollar budget ledger**: no per-session or per-team spend counter;
  spend surfaces only as provider-limit errors (FreeUsageLimit/upsell). The
  $47K-incident pain point is present.
- **No cross-session concurrency governor**: `Effect.semaphore` exists in the
  bundled Effect library, and `concurrency: 2` appears only inside a library
  combinator — no fleet-level in-flight cap across sessions. Per-provider
  discipline = SDK `maxRetries` + app retry policy; concurrency is unbounded.
- **No AIMD**: retry counts and delays are fixed constants, not load-adaptive.
- The retry storm is *mitigated* (jitter + retry-after honoring + 5-attempt
  cap) but **not bounded at the fleet level** — N sessions × 5 retries hit the
  provider with no shared governor.

## Verdict vs M-12's three runtimes

OpenCode ships **between naive and budgeted**: per-call retry discipline
(jitter, retry-after, hard caps — like our `aimd` runtime's backoff), a context
budget with eviction (budgeted-like at the window level), but **no token
ledger, no concurrency governor, no AIMD** (naive-like at the fleet level).
Prediction from our M-12 numbers: under a shared rate limit with N concurrent
sessions, OpenCode-style fleets reproduce the 429-storm column (~900k
backoffs/200 tasks in our sim) at the fleet level. That prediction is
**falsifiable against a multi-session OpenCode trace** — the next experiment.

## Evidence

- REA: `ev_1e7e6461…` (asar identity + inventory, 6,700 files, heap-limited
  parse noted in limitations)
- Constants quoted from `out/main/chunks/node-CRmY9MnM.js` (extracted from the
  digest-verified asar): retry policy block, `shouldRetry`, `delay8`,
  `retryable`, `isOverflow`, `usable2`
- Extraction scratch: `/tmp/opencode/oc-asar/` (not committed — 32 MB bundle)
