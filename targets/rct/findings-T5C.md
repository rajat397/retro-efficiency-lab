> **Depth class**: restated + informed-reconstruction (regraded 2026-11-12 per methodology depth bar — upgrade path in file)

# RCT2 Economy Probe — Ride Value & Guest Spend (OpenRCT2)

Authority: informed reconstruction of the original RCT2 (OpenRCT2 keeps original constants,
registers `rct2: 0x...` annotations, and preserves struct layouts). Read-only analysis of
/mnt/data/opt/openrct2 (commit ce18ebb). All paths below are relative to `src/openrct2/`.

## 1. Ride value computation

Ride value is **not** directly from uptime; it is a pure function of the ride's excitement /
intensity / nausea ratings, an age-decay table, and a duplicate-ride penalty.

**Ratings cadence.** `RideRating::UpdateAll()` runs every tick and advances a state machine
up to 20 substeps per state (`RideRatings.cpp:199-217`, budget constant at
`RideRatings.cpp:94`); ratings+value for a ride are recomputed when the machine reaches the
CALCULATE state: `RideRatings.cpp:443-444`:

```cpp
RideRatingsCalculate(state, *ride);
RideRatingsCalculateValue(*ride);
```

**Base value from ratings** (`RideRatings.cpp:1129-1133`) — each rating is weighted by the
ride type's `RatingsMultipliers` and scaled by `32 >> 15` (i.e. *32/32768*):

```cpp
money64 value = (((ride.ratings.excitement * ratingsMultipliers.excitement) * 32) >> 15)
    + (((ride.ratings.intensity * ratingsMultipliers.intensity) * 32) >> 15)
    + (((ride.ratings.nausea * ratingsMultipliers.nausea) * 32) >> 15);
```

**Age decay** (`RideRatings.cpp:1111-1122`): a fixed table keyed by age in months
(`getAge()` = months elapsed since build, `Ride.cpp:331-334`; build month
`Ride.cpp:5095-5096`). Table rows: <5 months +30; <13 +10; <40 ×1; <64 ×3/4; <88 ×9/16;
<104 ×27/64; <120 ×81/256; <128 ×81/512; <200 ×81/1024; ≥200 ×81/1024, with a final row
marked `// 0.56x "easter egg"` in the source (`RideRatings.cpp:1121`). First matching row
wins (`RideRatings.cpp:1151-1158`); rides older than the last row take the last row
(`RideRatings.cpp:1144-1147`). A cheat `disableRideValueAging` bypasses aging by keeping
`monthsOld = 0` (`RideRatings.cpp:1136-1139`; flag in `Cheats.h:41`).

**Duplicate-ride penalty** (`RideRatings.cpp:1161-1169`): if more than one *open* ride of
the same type exists, `value -= value / 4` (−25%).

**Clamp** (`RideRatings.cpp:1171`): `ride.value = std::max(0.00_GBP, value);`
New rides start at the undefined sentinel: `RideCreateAction.cpp:271` and
`Ride.h:791` `kRideValueUndefined = kMoney64Undefined`. Until a value is calculated,
"peeps will be willing to pay any amount for the ride" (`Guest.cpp:2112`).

UNANCHORED: whether original RCT2 applied the value formula with identical rounding is not
verifiable in-repo beyond the `rct2: 0x00695555`-style annotations preserved elsewhere; the
reciprocated-citation discipline above is the evidence offered.

## 2. Spend logic

### 2.1 What guests pay for

- **Park entry** (`Peep.cpp:1801-1831`): fee from `Park::GetEntranceFee`; vouchers halve
  (`VOUCHER_TYPE_PARK_ENTRY_HALF_PRICE`, `Peep.cpp:1806-1811`) or zero it
  (`Peep.cpp:1812-1817`). If `entranceFee > guest->cashInPocket` the guest turns away
  (`Peep.cpp:1819-1827`). Payment books the admission and spends:
  `Peep.cpp:1829-1830`
  ```cpp
  gameState.park.totalIncomeFromAdmissions = AddClamp(gameState.park.totalIncomeFromAdmissions, entranceFee);
  guest->spendMoney(guest->paidToEnter, entranceFee, ExpenditureType::parkEntranceTickets);
  ```
  The `PeepFlag::hasPaidForParkEntry` flag is set at `Peep.cpp:1831` — it discounts the
  guest's willingness to pay for rides (below).
- **Ride tickets** (`Guest.cpp:3815-3831`): on boarding, `RideGetPrice(ride)` is charged:
  `ride.totalProfit` increments (`Guest.cpp:3827`) and
  `spendMoney(paidOnRides, ridePrice, ExpenditureType::parkRideTickets)` (`Guest.cpp:3829`).
  Free-ride vouchers are consumed instead (`Guest.cpp:3820-3824`).
- **Food/drink/souvenirs** (`Guest.cpp:1438`, `GuestDecideAndBuyItem`, rct2: 0x0069AF1E):
  dispatched from shop visits (`Guest.cpp:3375,3386`) and on-ride photo prompts
  (`Guest.cpp:4402`). Payment at `Guest.cpp:1657-1661` via the per-category ledger
  (`paidOnFood`/`paidOnDrink`/`paidOnSouvenirs`, switch at `Guest.cpp:1627-1645`),
  plus stock cost `FinancePayment(shopItemDescriptor.Cost, ...)` (`Guest.cpp:1647-1648`).
  Every purchase counts as a customer: `ride.curNumCustomers++` /
  `ride.totalCustomers = AddClamp(ride.totalCustomers, 1u)` (`Guest.cpp:1663-1664`).
- **Toilets**: willingness scales with the toilet stat —
  `Guest.cpp:2191` `if ((RideGetPrice(ride) * 40 > guest.toilet) && ...)` (comment:
  "effectively has a minimum of $0.10 … and a maximum of $0.60", `Guest.cpp:2189-2190`).

### 2.2 The willingness-to-pay check (value vs price)

Two sites. **Decision-side** (choosing whether to go on the ride), `Guest.cpp:2110-2148`:

```cpp
money64 value = ride.value;
// The amount peeps are willing to pay is decreased by 75% if they had to pay to enter the park.
if (peepFlags.has(PeepFlag::hasPaidForParkEntry))
    value /= 4;
// Peeps won't pay more than twice the value of the ride.
ridePrice = RideGetPrice(ride);
if ((ridePrice > (value * 2)) && !(gameState.cheats.ignorePrice))
{
    insertNewThought(PeepThoughtType::badValue, ride.id);
    if (happinessTarget >= 60)
        happinessTarget -= 16;
    ride.updatePopularity(0);
    ...choseNotToGoOnRide...
}
// A ride is good value if the price is 50% or less of the ride value and the peep didn't pay to enter the park.
if (ridePrice <= (value / 2) && peepAtRide)
    ...insertNewThought(PeepThoughtType::goodValue, ride.id);
```

If a guest *does* ride, the acceptance gate at the entrance is
`PeepCheckRidePriceAtEntrance` (`Guest.cpp:2572`): no money → `spentMoney` thought and leave
(`Guest.cpp:2578-2583`); price > cash → `cantAffordRide` and leave
(`Guest.cpp:2585-2596`); then the same value test

```cpp
if (((value * 2) < ridePrice) && !(getGameState().cheats.ignorePrice))
{
    guest.insertNewThought(PeepThoughtType::badValue, guest.currentRide);  // "I'm not paying that much to go on X"
    ...return false;
}
```
(`Guest.cpp:2598-2607`).

**Shop items** use a separate value table, weather-adjusted: `getItemValue`
(`Guest.cpp:1407-1423`) picks `HotValue`/`ColdValue`/`BaseValue` by climate thresholds. The
comparison (`Guest.cpp:1517-1537`): if `itemValue < price`, overpricing is forgiven by
happiness — halved per happiness bracket (`>=128`, `>=180`, `Guest.cpp:1525-1529`) — and the
purchase still fails with the descriptor's `TooMuchThought` ("I'm not paying that much for
x", `Guest.cpp:1531-1536`) if the gap exceeds `ScenarioRand() & 0x07`. Underpriced items
roll a `GoodValueThought` (`Guest.cpp:1546-1549`) and add happiness:
`happinessTarget += itemValue * 4` (`Guest.cpp:1553-1555`). Note the random per-guest
threshold means the *same* measured overprice can pass or fail per guest (bounded noise).

### 2.3 Price-complaint thought itself

Thought insertion into a 5-slot array is `insertNewThought` (`Guest.cpp:7002-7042`): a new
thought is pushed to slot 0, existing list shifts down
(`Guest.cpp:7033-7039`), and it also triggers the matching animation from
`PeepThoughtToActionMap` (`Guest.cpp:7004-7011`). Thought aging: freshness increments after
220 ticks and is removed after ~6900 ticks (`Guest.cpp:5155-5180`).

## 3. The economics loop

Loop shape, with anchors at each edge:

1. **Ratings → value.** Ratings state machine recomputes excitement/intensity/nausea and
   ride value periodically (`RideRatings.cpp:443-444`; driver at `GameState.cpp:333`).
2. **Value → guest decision.** Guest compares `value` (÷4 if park entry paid) to price with
   the 2× ceiling and 50% "good value" band (`Guest.cpp:2110-2148`); entering also checks
   affordability (`Guest.cpp:2578-2596`).
3. **Decision → popularity.** Deciding to visit records
   `ride.updatePopularity(1)` (`Guest.cpp:2155`, also `Guest.cpp:2237` for shops); a
   badValue complaint or toilet overprice records `updatePopularity(0)` — visited but did
   not buy (`Guest.cpp:2131,2200`). Popularity accumulates over 25 update-ticks into the
   displayed stat (`Ride.cpp:921-931`).
4. **Decision → purchase → ride income.** Payment increments `ride.totalProfit`
   (`Guest.cpp:3827` rides; `Guest.cpp:1661` shops, net of stock `Cost`) and books finance
   via `spendMoney` → `FinancePayment(-amount, expenditure)` (`Guest.cpp:2270`), which
   debits the park ledger by expenditure class.
5. **Purchases → customer history.** `curNumCustomers` (`Ride.h:359`) accumulates per
   purchase (`Guest.cpp:1663`); every 960 ticks (~30 s) `Ride::update()` shifts the history
   and samples it (`Ride.cpp:818-833`):
   ```cpp
   // Shift number of customers history, start of the array is the most recent one
   for (int32_t i = Limits::kCustomerHistorySize - 1; i > 0; i--)
       numCustomers[i] = numCustomers[i - 1];
   numCustomers[0] = curNumCustomers;
   ```
   `incomePerHour` and `profit` are refreshed in the same block (`Ride.cpp:835-839`),
   derived from `RideCustomersPerHour` = last-5-minutes × 12 (`Ride.cpp:5055-5072`) and
   price minus stock cost (`Ride.cpp:430-464`).
6. **Income/value → park metrics.** Every 512 ticks the park recomputes
   `totalRideValueForMoney` (sum of `open` rides' `value − price`, doubled,
   `Park.cpp:75-101`; recompute at `Park.cpp:338`) alongside park rating and guest cap
   (`Park.cpp:334-340`). `calculateRideValue` for park-value display blends ride value with
   recent customers ×10 plus type BonusValue ×4 (`Park.cpp:64-73`).
7. **Park metrics → guest generation.** Entrance fee over `totalRideValueForMoney` divides
   the guest-generation probability by 4 (and by 4 again if over 2×) (`Park.cpp:186-196`);
   awards swing it ±25% (`Park.cpp:199-209`). Awards themselves are value-driven:
   "Best Value" requires `entranceFee + 0.10 < totalRideValueForMoney / 2` and
   `totalRideValueForMoney >= 10.00_GBP` (`Award.cpp:192-196`); "Worst Value" fires when
   `entranceFee > totalRideValueForMoney` (`Award.cpp:242-246`). A scenario warning fires
   when the fee exceeds `totalRideValueForMoney + totalRideValueForMoney/2`
   (`Scenario.cpp:207`).
8. **Guests → happiness → repeat purchases.** Good-value purchases raise
   `happinessTarget` (`Guest.cpp:1553-1555`); overpriced refusals cut it −16
   (`Guest.cpp:2127-2130`). Satisfaction also feeds the ride's satisfaction stat via
   `updateSatisfaction` (`Guest.cpp:1572` → `Ride.cpp:900-911`) and post-ride value
   satisfaction offsets (`GuestCalculateRideValueSatisfaction`, `Guest.cpp:2670-2694`:
   returns −5 when `value >= price`, −30 when happiness-weighted value still falls short of
   price, else 0 — signs as-written in source; the function's header comment lists the
   intended factors at `Guest.cpp:2612-2618`).

## 4. Bounded resources

- **Money types** (`core/Money.hpp:15-17`): `money16 = fixed16_1dp`, `money32 = fixed32_1dp`,
  `money64 = fixed64_1dp`; sentinel `kMoney64Undefined = 0x8000000000000000`
  (`Money.hpp:49`). Current runtime money is `money64` throughout the economy.
- **Legacy widths**: park `TotalRideValueForMoney` was `uint16_t` in the S6 park struct
  (`rct2/RCT2.h:909`, imported at `rct2/S6Importer.cpp:459`); legacy ride value serialized
  as `uint16_t` with `0xFFFF` meaning undefined (`ParkFile.cpp:1756-1764`).
- **Customer history**: `kCustomerHistorySize = 10` (`Limits.h:20`,
  `rct12/Limits.h:48`), array `uint16_t numCustomers[10]` (`Ride.h:363`). Downtime history
  is 8 entries (`rct2/Limits.h:21`, array `Ride.h:416`).
- **Thought slots**: `kPeepMaxThoughts = 5` (`entity/Guest.h:22`), stored as
  `std::array<PeepThought, kPeepMaxThoughts> thoughts` (`entity/Guest.h:327`).
  Price complaints (`badValue`, `notPaying`, `cantAffordRide`, `spentMoney`,
  `cantAffordItem`, `goodValue`) all occupy these same slots, competing with
  non-economy thoughts like `hungry`/`lost` — insertion evicts the oldest slot 0 entry and
  shifts the rest (`Guest.cpp:7033-7041`).
- **Cash**: guests start with `scenarioOptions.guestInitialCash + (rand%4 * 100 − 100)`
  clamped ≥0, forced to 500 if initial cash is 0 and to 0 under no-money
  (`Guest.cpp:7327-7345`). Ledger fields are `money64` (`Guest.h:317-318`) and all writes
  saturate via `AddClamp` (`Guest.cpp:2263-2265`).
- **Price array**: `money64 price[kMaxShopItemsPerRideEntry]` (`Ride.h:364`); ride value is
  `money64` (`Ride.h:367`); counters `curNumCustomers uint16_t` (`Ride.h:359`),
  `totalCustomers uint32_t` (`Ride.h:374`), `totalProfit money64` (`Ride.h:375`).
- **Admission counters**: `totalAdmissions uint64_t`, `totalIncomeFromAdmissions money64`
  (`world/ParkData.h:115-116`).

## 5. Mechanism assessment

- **M-11 (work budgets) — partial, indirect.** Not a guest-facing budget, but computation
  is budgeted: the ratings/value stepper processes at most 20 substeps per state per tick
  (`RideRatings.cpp:94,206-215`) and customer statistics update on a 960-tick cadence
  (`Ride.cpp:818-822`). These amortize work rather than gate guest behavior; treat M-11 as
  weakly present.
- **M-5 (measured slowdown / measured decisions) — partial.** The value check is a
  *measured decision*: guests reject prices above a measured quantity (ride value from
  ratings) with fixed ratios (2× ceiling, 50% good-value band, ÷4 entry discount) and
  bounded randomness (`ScenarioRand() & 0x07` for shop items, `Guest.cpp:1531`).
  However, no *slowdown* mechanism exists — nothing scales time, speed, or cadence by
  price/value. If M-5 strictly means time-scaled throttling, the honest verdict is
  "measured-decision gate only, no measured slowdown".
- **M-2 (fixed pools) — strong match.** Multiple fixed-size state pools carry the economy:
  the 10-slot customer history (`Limits.h:20`, `Ride.cpp:826-830`), the 5-slot thought
  array where every pricing thought competes for space (`Guest.h:22,327`,
  `Guest.cpp:7033-7041`), and the 8-slot downtime history (`rct2/Limits.h:21`).

## 6. Honesty section

- The sign convention of `GuestCalculateRideValueSatisfaction` (−5/−30/0,
  `Guest.cpp:2683-2693`) is quoted exactly as written. The in-file comment
  (`Guest.cpp:2612-2618`) states the intent but not the sign rationale; the original RCT2
  intent of the negative-only offsets is UNANCHORED in this repo.
- The `"easter egg"` label on the final age-table row (`RideRatings.cpp:1121`) is a
  source comment reproduced verbatim; what the easter egg consists of is UNANCHORED here.
- Whether OpenRCT2's `RatingsMultipliers` per ride type exactly match original RCT2 values
  was not cross-checked against a table dump in this session — UNANCHORED.
- Shop-item `BaseValue`/`HotValue`/`ColdValue` per-item numbers live in object
  descriptors (`Guest.cpp:1409-1422`) and were not enumerated — UNANCHORED.
- `popularityTimeout` comment "Updated every purchase and ?possibly by time?"
  (`Ride.h:377`) is the upstream author's own uncertainty; reproduced, not resolved.
- Search notes: no uptime/downtime term feeds `RideRatingsCalculateValue` (grep for
  `uptime|downtime` in RideRatings.cpp returned no hits in the value path); downtime only
  appears as a ride stat with its own history array (`Ride.h:413-416`). No separate
  "guest willingness multiplier per guest type" for rides was found beyond the
  happiness-bridging and entry-fee-÷4 rules anchored above.

No source under /mnt/data/opt/openrct2 was modified; this document is the only file written.
