> **Depth class**: measured (real traffic from this machine's own opencode
> session store; every number is a count, not a model)

# T9 Findings — real agent-traffic arrival shape and concurrency demand

Source: the local opencode SQLite store — **38,513 tool invocations** with
start timestamps, spanning **1,613 hours** of wall-clock across all sessions
on this machine. Extraction script: `scripts/extract-fanout.mjs`; data file:
`targets/opencode/data/fanout-bursts.json`.

This target answers the question M-13 needed answered with data rather than
assumption: **what does real agent traffic's arrival process actually look
like?** Erlang's capacity math assumes Poisson arrivals. If real traffic is
Poisson, the closed form is fine and the Erlang gap does not exist.

## 1. Arrivals are not Poisson — they are fan-out bursts

A *burst* is a group of tool calls whose starts fall within a window of the
group's first start (per session). The window is a **method choice**, so the
extraction reports the sensitivity rather than a single number:

| window | bursts | E[X] | E[X²] | κ = E[X²]/E[X]² | P(X>1) |
|---|---|---|---|---|---|
| 50 ms | 31,172 | 1.2353 | 2.1318 | 1.3969 | 11.9 % |
| 100 ms | 30,735 | 1.2529 | 2.2635 | 1.4419 | 12.3 % |
| 250 ms | 30,457 | 1.2643 | 2.3335 | 1.4597 | 12.7 % |
| 500 ms | 30,120 | 1.2785 | 2.3966 | 1.4662 | 13.7 % |
| **1000 ms (canonical)** | **29,852** | **1.2901** | **2.4472** | **1.4703** | **14.4 %** |
| 2000 ms | 29,549 | 1.3032 | 2.5223 | 1.4852 | 15.0 % |
| 5000 ms | 24,492 | 1.5720 | 3.8986 | 1.5786 | 29.7 % |

Across a **40× range of windows** (50 ms → 2000 ms) E[X] moves only
1.235 → 1.303 and κ moves 1.397 → 1.485. The shape is not an artifact of the
window. (The 5 s window is excluded: it merges *separate agent turns* rather
than fan-out, and its jump to E[X] = 1.57 shows that.)

**κ = E[X²]/E[X]² = 1.4703** is the count-variance inflation factor: real
agent traffic carries **47 % more count-variance than Poisson**. When a
fan-out happens it is worth ~3 calls (E[X | X>1] = 3.01).

## 2. Concurrency demand — the quantity an Erlang plan actually sizes

| | value |
|---|---|
| peak concurrent in-flight tool calls | **25** |
| mean concurrency (time-weighted) | 0.1927 |
| histogram | 21,407 samples at 1 · 10,961 at 2 · 8,752 at 3 · 7,485 at 4 · 5,398 at 5 · 3,249 at 6 · 1,879 at 7 · 1,117 at 8 · 624 at 9 · 394 at 10 · … 751 samples above 10 |

Long right tail: most of the time one call is in flight, with a thin tail out
to 25. This is the shape an Erlang capacity plan must size against.

## 3. Arrival rate

| | value |
|---|---|
| observation span | 1,613.1 h |
| tool-call starts/s overall | 0.0066 |
| active time (≥1 call in flight) | 14.26 % of span |
| starts/s while active | 0.0465 |

## 4. Why the service time here is NOT usable as μ

Tool-call durations in the store include agent and human idle time, so they
are not service times:

| tool | mean ms | n |
|---|---|---|
| bash | 40,193 | 18,296 |
| read | 287 | 9,674 |
| edit | 129 | 3,368 |
| write | 9,686 | 2,198 |
| task (sub-agent) | 291,290 | 1,213 |

Overall p50 115 ms but p99 371,450 ms and max 88,319,624 ms (24.5 h) — a
session left open overnight. **These are wall-clock spans of agent thinking,
not provider service times.** Any capacity model that used them as μ would be
measuring the operator's coffee breaks. M-13 therefore takes μ from the
scenario (a 4 s mean provider call) and says so; it does not pretend this
table supplies μ.

## 5. What this target is for

It is the **premise check** for M-13 (`catalog/transfer-tests/M-13-erlang-capacity/`):
Erlang's closed form assumes Poisson arrivals, and this measurement shows real
agent traffic is not Poisson (κ = 1.47). M-13 then measures what that
assumption costs — a 3.4× delay gap and up to 2 circuits of under-provisioning.

It also partially answers the lab's standing open item — "real traffic traces
(needs a partner)" — from local data rather than a partner: the arrival
*shape* and concurrency *demand* are now measured, even though no partner
traffic exists yet.

## Scope honesty

- These are **tool calls**, not provider API calls. The proxy from "one agent
  fans out to several tool calls" to "one agent fans out to several provider
  calls" is plausible but unproven; M-13 uses the measured shape as an
  arrival-shape input and states the mapping.
- One machine, one operator, one workload mix. The *shape* is measured; the
  *rates* are not generalizable.
- The 5 s window's different result is reported, not hidden.
