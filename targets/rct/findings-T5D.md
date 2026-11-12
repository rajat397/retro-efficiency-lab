> **Depth class**: restated + informed-reconstruction (regraded 2026-11-12 per methodology depth bar — upgrade path in file)

# RCT2 Park-Rating Computation — OpenRCT2 Probe (T5D)

Authority class: informed reconstruction (OpenRCT2 preserves original RCT2 structure and
annotates original addresses as `rct2: 0x...` comments). All anchors verified by direct
read of the read-only tree at /mnt/data/opt/openrct2. No source files were modified.

Companion probe: findings-T5A.md documents that guest generation consumes the rating
(`probability = 50 + clamp(rating − 200, 0, 650)`, `world/Park.cpp:166`). This probe
documents what produces the rating itself, closing the loop.

## 1. The rating formula

Core function: `CalculateParkRating`, `src/openrct2/world/Park.cpp:376`. Cheat override
returns the forced value immediately (`Park.cpp:378-381`). The baseline is 1150, or 1050
under the `difficultParkRating` scenario flag (`Park.cpp:383-387`); all components are
then *subtractions* recovering toward a 0–999 score, clamped at the end
(`Park.cpp:488`: `result = std::clamp(result, 0, 999)`).

### 1.1 Guests — `src/openrct2/world/Park.cpp:389-424`

```cpp
// -150 to +3 based on a range of guests from 0 to 2000
result -= 150 - (std::min<int32_t>(2000, park.numGuestsInPark) / 13);
```
(`Park.cpp:392`) — low crowd counts cost up to 150 points; 2000+ guests fully refund it.

Happiness (`Park.cpp:395-417`): every in-park guest with `happiness > 128` is counted,
then `result += 2 * min(250u, (happyGuestCount * 300) / numGuestsInPark)` — the
happiness term is bounded at +500 (`Park.cpp:416`), after a flat −500 (`Park.cpp:413`).

Lost guests (`Park.cpp:405-407, 419-422`): guests leaving the park with
`guestIsLostCountdown < 90` count as lost; the first 25 are free, then −7 points each
(`Park.cpp:420-422`).

### 1.2 Rides — `src/openrct2/world/Park.cpp:426-475`

Three ride components over all rides in `RideManager(gameState)`:

1. **Uptime** (`Park.cpp:435, 444-448`): each ride contributes `100 - downtime`; the
   average × 2 (bounded +200) is added after a flat −200.
2. **Excitement/intensity target** (`Park.cpp:449-469`): for rides with ratings,
   average `excitement/8` and `intensity/8`; deviations from targets 46 and 65 are
   halved, capped at 50 each, and `result += 100 − devE − devI` — rides *too dull or
   too wild* lose points.
3. **Total ratings volume** (`Park.cpp:472-474`): total excitement and intensity are
   each capped at 1000, then `result -= 200 − (sum / 10)`.

### 1.3 Litter — `src/openrct2/world/Park.cpp:477-485`

```cpp
// Counts the amount of litter whose age is min. 7680 ticks (5~ min) old.
...
result -= 600 - (4 * (150 - std::min<int32_t>(150, litterCount)));
```
(`Park.cpp:479-484`). Only stale litter (age ≥ 7680 ticks) penalizes; the penalty
component is bounded: 150 pieces of old litter cost the full −600.

### 1.4 Casualty/crash penalty — `src/openrct2/world/Park.cpp:487`

A stored `ratingCasualtyPenalty` (declared `ParkData.h:73`, `int16_t`) is subtracted
last. It grows from accidents and decays over time:

| Event | Effect | Anchor |
|---|---|---|
| Guest death | `+25`, capped at 1000 | `src/openrct2/entity/Peep.cpp:792` |
| Ride crash casualty | `+200`, capped at 500 | `src/openrct2/ride/Vehicle.Crash.cpp:307-309` |
| Decay | `−7` per day (−40 if no-money scenario) | `src/openrct2/scenario/Scenario.cpp:323-324` |
| Reset on scenario load | `= 0` | `src/openrct2/scenario/Scenario.cpp:132` |

### 1.5 Vandalism

Vandalism does **not** enter `CalculateParkRating` directly in this codebase. It enters
indirectly through the award system: the "Most Untidy" award requires > 1/16 of guests
thinking `badLitter`, `pathDisgusting`, or `vandalism` thoughts
(`src/openrct2/management/Award.cpp:91-118`), and awards modulate guest generation
(§2), not the rating itself.

## 2. Feedback-loop closure

Full loop, with the T5A consumer cited:

**Guests → ride value.** `RideRatingsCalculateValue` (`ride/RideRatings.cpp:1105`)
sets `ride.value` from excitement/intensity/nausea with ride-type weights, minus an
age-decay table (`kAgeTable`, `RideRatings.cpp:1109-1120`: rides lose value over
months-old thresholds, down to 0.08× at 200 months) and a −25% penalty per additional
open ride of the same type (`RideRatings.cpp:1161-1169`); clamped ≥ 0
(`RideRatings.cpp:1171`). Ride ratings themselves are refreshed as the game cycles
rides (`ride_ratings_update_state_3` → `RideRatingsCalculateValue`, `RideRatings.cpp:443-444`).

**Ride value → rating inputs.** `totalRideValueForMoney` sums `(ride.value − price) × 2`
over open, non-broken rides (`world/Park.cpp:75-101`); the park-rating ride terms read
`ride.downtime` and `ride.ratings.*` directly (`Park.cpp:435-474`).

**Rating → guests.** Per T5A: `Park.cpp:166`
`probability = 50 + clamp(rating − 200, 0, 650)`, plus the ÷4 dampers (crowd cap,
52000 cap, overpriced fee) and ±25%/award terms (`Park.cpp:199-210`), executed against
a 65535 draw every tick (`Park.cpp:218-229`).

**Guests → rating (negative leg).** More guests → more litter entities and more
unhappy/lost guests → the guest, happiness and litter terms lower `result`
(`Park.cpp:389-484`).

**Awards as a derived multiplier layer.** Awards are granted monthly by random
`AwardUpdateAll` draw (`management/Award.cpp:636-688`, original `rct2: 0x0066A86C`
annotated at `Award.cpp:634`): a random unused type is checked against ~17 predicates
of measurable park state (tidiness thought ratios, staff ratios, shop counts, fee vs
ride value, `park.rating > 650` gate for "Most Disappointing" at `Award.cpp:427`, etc.).
Each award lives 5 time-units (`Award.cpp:624`: `Award{ 5u, type }`), decrements once
per month (`Award.cpp:644-651`), and each *positive* award adds +25% of the current
guest probability while a negative one subtracts it (`Park.cpp:199-210`). So awards
are a slow, state-derived modulation of the rating→guest gain, not a rating input.

**Loop stabilizers (all anchored):**
- Rating output clamp 0–999 (`Park.cpp:488`); base is fixed, so a rating can only
  saturate, never blow up.
- Guest term refund capped by `min(2000, guests)` (`Park.cpp:392`); happiness capped
  at +500 (`Park.cpp:416`); lost-guest penalty counts only the excess over 25
  (`Park.cpp:420-422`).
- Excitement/intensity volumes capped at 1000 each (`Park.cpp:472-473`).
- Litter penalty bounded by `min(150, litterCount)` (`Park.cpp:484`).
- Casualty penalty hard caps (1000 deaths / 500 crash) plus daily decay
  (`Peep.cpp:792`; `Vehicle.Crash.cpp:307-309`; `Scenario.cpp:323-324`).
- Guest side: probability clamp 650 + ÷4 dampers and the free-entity veto (< 400
  free entities, `entity/Guest.cpp` in `Guest::generate`) per T5A.
- Ride value saturates downward through the age table (`RideRatings.cpp:1109-1120`)
  and the same-type −25% penalty (`RideRatings.cpp:1168-1169`), so the value leg
  cannot compound indefinitely from popularity alone.

## 3. Update cadence

`Park::Update` runs every game tick (`GameState.cpp:329` per T5A). The rating itself
recomputes **once every 512 ticks (~13 s)**, together with
`totalRideValueForMoney`, `suggestedGuestMaximum` and `guestGenerationProbability`
(`src/openrct2/world/Park.cpp:333-340`: `if (currentTicks % 512 == 0)` then
`park.rating = CalculateParkRating(...)` at `Park.cpp:336`). Awards refresh monthly
via `ScenarioUpdate` day/week/fortnight/month dispatch (`scenario/Scenario.cpp:415-430`,
month start at `Scenario.cpp:427-429` → `ScenarioMonthUpdate()` → `AwardUpdateAll()`,
`Scenario.cpp:364`). A weekly history snapshot pushes the rating into
`ratingHistory` (`world/Park.cpp:566-584`, push at `Park.cpp:584`).

So the loop is **two-timescale**: the rating variable moves on a ~13 s period; the
award modulation moves on a ~months period; the tick-level consumer (`generateGuests`)
only reads the stored values.

## 4. Bounded resources

| Resource | Constant / type | Anchor |
|---|---|---|
| Rating output clamp | `std::clamp(result, 0, 999)` | `src/openrct2/world/Park.cpp:488` |
| Rating storage | `uint16_t rating` | `src/openrct2/world/ParkData.h:71` |
| Rating history slots | `kParkRatingHistorySize = 32`, sentinel `uint16 max` | `src/openrct2/world/ParkData.h:30,32,72`; push `world/Park.cpp:584` |
| Casualty penalty storage / caps | `int16_t` at `ParkData.h:73`; cap 1000 (`Peep.cpp:792`), cap 500 (`Vehicle.Crash.cpp:307-309`) | see §1.4 |
| Current awards | `std::vector<Award> currentAwards`, max `kMaxAwards = 4` (RCT2 limit, `src/openrct2/rct12/Limits.h:19`, aliased `src/openrct2/Limits.h:34`) | `src/openrct2/world/ParkData.h:132`; insertion gate `Award.cpp:672`; forced-insert erase `Award.cpp:698-701` |
| Award lifetime | `Award{ 5u, type }`, decremented monthly, erased at 0 | `src/openrct2/management/Award.cpp:624, 644-651` |
| Litter penalty bound | `min(150, litterCount)` | `src/openrct2/world/Park.cpp:484` |
| Litter age threshold | `getAge() >= 7680` ticks (~5 min) | `src/openrct2/world/Park.cpp:482` |
| Ride-rating volume caps | `min(1000, totalRideExcitement)` × 2 | `src/openrct2/world/Park.cpp:472-473` |
| Ride value clamp | `std::max(0.00_GBP, value)` | `src/openrct2/ride/RideRatings.cpp:1171` |

## 5. Mechanism assessment — M-5 "measured slowdown"

**Fit: good, symmetric with T5A.**

- The rating is a *measured, modulated control variable* on a slow tick schedule
  (512 ticks, `Park.cpp:334`), not a per-tick noisy signal: it aggregates whole-park
  state (guest counts, happiness ratios, litter age, ride uptime/ratings) into one
  bounded scalar before the fast consumer (guest spawn probability, T5A §1.2) reads it.
- The loop is **negative feedback in both legs**: guests degrade tidiness/happiness
  (lowering rating) while ride value and uptime raise it, and the guest-side dampers
  (÷4 terms, free-entity veto) sit between the two. This is the same cap-squeeze/
  throttle family T5A classified.
- The timescale asymmetry is notable: the *rating* (512 ticks) is faster than guest
  generation *recomputation* (also 512 ticks — both in the same block, `Park.cpp:334-340`),
  but awards (monthly, `Scenario.cpp:364`) and ride-value aging (`kAgeTable` in
  months, `RideRatings.cpp:1109-1120`) are much slower. Relative to T5A's 512-tick
  generation recompute, the rating is a peer fast layer, and the award/aging layers
  are the slow layers. Honest verdict: M-5 fits the rating↔guest pair as a jointly
  sampled measured loop; the three-timescale picture (512-tick / monthly / month-age)
  is richer than a plain "two-timescale" label but does not contradict it.
- Bounded-resource behavior is textbook: every term has an explicit cap (§4), and the
  only unbounded quantity on the guest leg is inside the already-damped probability
  clamp documented in T5A.

Weaker fit (honest caveat): vandalism, named in the mission brief as a rating
component of the original game, is not a direct rating term in this port — it acts
only through award eligibility (`Award.cpp:91-118`). Whether original RCT2 scored
vandalism inside the rating routine could not be verified from OpenRCT2 alone.

## 6. Honesty section — UNANCHORED items

- **UNANCHORED:** the precise original-address mapping of `CalculateParkRating`.
  The function at `Park.cpp:376` carries no `rct2:` comment (the only `rct2:` comment
  near it in Park.cpp is `rct2: 0x00664D05` on `UpdateFences`, `Park.cpp:637`), so the
  original routine address was not verified here.
- **UNANCHORED:** `ride.value` update cadence. `RideRatingsCalculateValue` is invoked
  from `ride_ratings_update_state_3` (`RideRatings.cpp:444`) within the ride-rating
  state machine, but the full state-machine tick schedule (how many rides per tick /
  period) was not traced in this probe; only the invocation site is anchored.
- **UNANCHORED:** whether original RCT2 included a direct vandalism term in the
  rating. In OpenRCT2 it appears only via award predicates (`Award.cpp:91-118`);
  no direct term exists in `Park.cpp:376-489`, but the original's scoring could not
  be checked from this tree.
- **UNANCHORED:** `scenarioParkRatingWarningDays` (`ParkData.h:74`) consumption —
  the warning-day counter was seen only in the struct; its update/consumer logic was
  not traced in this probe.
- All other anchors in this file were verified by direct read of the cited lines.
