# Transfer test — M-10 index-linked membership lists vs full-pool scan

**Claim tested.** RCT2 (in-record `NextInQuadrant`/`Next`/`Previous` +
`LinkedListTypeOffset` discriminator, `RCT12.h:1012-1019`) and Duke3D/Build
(index-keyed side arrays, `ENGINE.C:4265-4273`) keep every entity in one fixed
pool with membership lists of slot indices — an entity sits in multiple lists
at once, and iteration walks only the needed subset. Transfer property:
**query cost scales with the subset, not the pool**, and churn is O(1).

## Results (Node 22, 65,536-slot pool, 200 queries)

| Scenario | list-walk | full-scan (with membership test) | ratio |
|---|---|---|---|
| subset = 1k of 65k | 8.7 ms | 33.0 ms | **3.78×** |
| subset = 25k of 65k | 29.7 ms | 336.3 ms | **11.32×** |

Churn: 100k unlink+link ops = **143 ns/op** with the discriminator discipline;
list counts stay consistent (sum = pool size exactly).

**The documented cost, demonstrated live:** the *undisciplined* variant
(unlinking from a list the slot isn't in) corrupts counts within one churn
cycle — this is RCT2's historical linked-list-corruption bug class, reproduced
on purpose in the bench output. The discriminator (`memberOf` side array /
RCT2's `LinkedListTypeOffset`) is not optional decoration; it is what makes
the mechanism safe.

## Verdict

**Proven.** Query cost scales with the subset (3.8× at 1k, 11.3× at 25k —
superlinear in subset *fraction* because the full scan also pays the
membership test), churn is O(1), and the failure mode matches the historical
record. In-product receipt: TIDE's search walks only the target buffer's line
list (3.7× on a 3-buffer workload, `tide/bench.mjs`).

Reproduce: `node bench.mjs`
