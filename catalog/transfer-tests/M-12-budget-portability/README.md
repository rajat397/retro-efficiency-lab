// M-12 transfer test — agent-fleet budgets vs naive loop (deterministic DES).
// See bench.mjs for the full model. This README is the short form.

# M-12 transfer test: budget portability (TH04 → agent fleet)

Simulated provider (8 concurrent / 15,000→7,500 TPM, halving at minute 1),
200 tasks (20 runaway agents that never converge), virtual clock, metered
metrics — no LLM calls, no network.

```
metric                        | naive     | budgeted
real tasks completed          | 146/180   | 180/180
runaway agents stopped        | 0         | 20 (budget-killed, turn 12)
tokens burned past budget     | 633,374   | 0      (20% of spend = $1.27)
429 backoffs                  | 900,937   | 0      (leased bucket)
p99 lag                       | 26,223 s  | 25,860 s (quota-bound both)
step-downs on quota halving   | 0         | 1      (M-5, one-time)
orchestration trace hash      | —         | IDENTICAL across runs (oracle)
```

Mechanisms exercised: M-2 (call pool), M-11 (per-task turn budget),
M-5 (step-down on external quota change), plus the leased token bucket
(card break-point 1). Break-points 2–4 (quality ladder, real-LLM
determinism, context eviction) remain unexercised — recorded in the card.

Run: `node bench.mjs`
