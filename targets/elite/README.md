# Target (bonus) — Elite galaxy generator (Braben & Bell, 1984)

Status: **witnessed** (2026-11-12)

## Witness authority

Canonical algorithm per Ian Bell's released sources; implementation verified via
`jrmhaig/elite_universe` (`lib/elite_universe/planet.rb`), cloned to
`/mnt/data/opt/elite`.

## Findings (M-6 second witness)

- `twist(arr) = [arr[1], arr[2], arr.sum % 65536]` — Fibonacci-style 16-bit
  shift register over three seed words (planet.rb:46).
- 4 twists per planet (`def next`), 256 planets per galaxy chained; 8 galaxies
  from 8 starting seeds — **256×8 worlds from 48 bits**.
- Everything derived: name (3-char pairs from a packed char table, planet.rb:20),
  government/economy (bit fields of w1), position (w1>>8, w0>>8), tech level
  (mixed bit fields) — planet.rb:32-43.
- Deterministic and sequence-locked: regenerating planet N requires walking
  0..N-1 (or checkpointing seeds) — the documented cost, now in the card.
