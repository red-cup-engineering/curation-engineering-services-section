# Hive vote scheduling

`scheduleSetOfVotes(request)` delegates valuation, reward eligibility, prior-vote exclusion and mana allocation to the shared Hive Computing selector. It returns a `VoteScheduleRecord` with scheduled votes and the original refusal reasons.

The request supplies the following data.

- `yieldReadout` contains the account voting manabar and observed reward prices for each tag.
- `account` selects an account present in that readout.
- `candidatePosts` contains two-node witnessed entries with `tag`, `symbol` and the original bridge `post` record.
- `curationWindowSeconds` comes from the chain configuration. A selected vote waits for this reverse-auction window when needed.
- `price` supplies an optional chain reward price when a tag has no observed price. Rational components accept decimal strings or BigInts.
- `policy` supplies vote weights, preferred tags, excluded authors and the mana budget. Defaults are defined with the implementation.
- `now` supplies an optional ISO instant for deterministic replay.

Repeated tag appearances identify one candidate by author and permlink. Each selected vote carries its UTC time and RFC 5545 `dtstart` for one execution.

## JavaScript

```js
import { scheduleSetOfVotes } from "@red-cup-engineering/schedule-set-of-votes-service";
```

## Command

`schedule-set-of-votes` reads one JSON request per input line and writes one JSON result per output line.
