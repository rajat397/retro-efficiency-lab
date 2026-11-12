# Transfer test — M-1 event-program-as-VM: extensibility, cost, determinism

**Claim tested.** Game behaviors ship as interpreted event programs (data) so
tools and shipped binaries can author/modify behavior without a compiler —
MarioXP's event editor, TH04's event chunks, Another World's 64-thread VM.
Transfer properties: extensibility surface, interpreter tax, replay stability.

## Results (Node 22, TH04/AW-shaped VM: opcode table, threads, deferred rebinds)

| Property | Result |
|---|---|
| New behavior ("spiral") | **4 data rows, 0 interpreter lines added** (vs ~6+ lines + dispatch arm for a compiled path) |
| Interpreter tax (5M ops) | VM 103.8 ns/op vs inlined 5.1 ns/op — **~10–22× per op** (GC-pressure dependent, honest range) |
| Replay determinism | two full runs → hash **IDENTICAL** (`f8c5f405`) |

## Verdict

**Proven** — with the honest decomposition: behaviors-as-data cost a real,
measured interpreter tax (10–22× per op) and buy (1) zero-code-change
extensibility, (2) tool-authorable behavior (any tool can emit opcode rows —
MarioXP shipped its event *editor* in the binary), and (3) replay-stable
execution. The tax is the M-1 card's costs field, quantified. Cross-thread
self-mutation's order-independence is M-3's proven territory; M-1's VM here
reuses that deferred-rebind boundary.

## Bench bugs caught en route (documented per lab rules)

- The first run OOM'd: the VM's `spawn` op grew entities unboundedly — fixed
  by giving the VM a **bounded entity pool** (full pool → drop spawn: TH04's
  440-bullet law, M-2's mechanism).
- The determinism section hung: thread programs with `jump` looped ~333M ops
  *inside one `step()`* — fixed with a **per-frame instruction budget**
  (TH04/AW's own execution discipline), which is also the honest mechanism.

Reproduce: `node bench.mjs`
