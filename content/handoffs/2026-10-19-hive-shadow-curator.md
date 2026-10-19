# Handoff, 2026-10-19: Hive shadow curator

For a fresh agent. Nothing here votes, signs or broadcasts; a live vote spends real voting power and needs the Leader's authorization after readiness passes.

## What was measured (public Hive API, 2026-10-19)

- `HIVE_REVERSE_AUCTION_WINDOW_SECONDS_HF25` is 0. The reward curve, measured from 96 paid posts' `curation_reward` operations (about 8,700 rewarded upvotes), is flat for the first 24 hours (median multiplier 1.00), about 0.81 for the next five hours, about 0.52 from 30 hours to 3 days, about 0.13 from 3 to 7 days. See `content/reports/2026-10-19-hive-curation-edge.json` (`curve`, with bootstrap intervals).
- Rewards are linear in net rshares and shared pro rata among positive rshares. The curators' pool per net rshare is nearly constant across posts (p10 to p90 within 5 percent). So a vote earns about the same per rshare on any post that pays; post choice matters only through the chance the post pays curators at all.
- The chain pays a post only if its total payout reaches `HIVE_MIN_PAYOUT_HBD` (0.020 HBD, from `condenser_api.get_config`). Measured on 953 root posts sampled 2026-10-06 to 2026-10-11 with final outcomes (paid or not): with the median total payout per net rshare (7.1e-14 HBD, p10 to p90 6.8e-14 to 7.4e-14), "net rshares times that rate is at least 0.02" separates the posts that paid from those that did not for 675 of 676 paying and 136 of 136 non-paying posts with positive net rshares. About 29 percent of posts paid curators nothing: 13 had rewards declined, 55 net non-positive, 73 no votes, 136 positive but under the minimum. Our own vote is small (emsenn0 holds about 1.04e6 effective VESTS, so a full vote is about 2e10 rshares, worth about 0.0015 HBD in total), so it rescues no sub-minimum post alone.
- Edge: a ridge logistic predictor of "this vote earns an ordinary reward" from the post's state at time t (votes, rshares up and down, flags), fitted walk-forward over four folds, scored on 712 held-out posts. Voting only the top half by prediction instead of every candidate earns 34 to 36 percent more reward per unit rshare (95 percent interval about 31 to 37 percent) at 5 minutes, 1 hour and 6 hours; the top quarter 36 to 38 percent. Brier score of the prediction 0.058 to 0.082 against 0.199 for the base rate. Readiness (`assessClusteredEdge`) passes on the backtest in all twelve cells. This is a backtest; it authorizes nothing. The size of the prize is small: baseline reward is about 2.6e-14 HBD per rshare, so about 5e-4 HBD per full vote of emsenn0 before the edge.
- Baseline is a uniform vote on every candidate. That is what the existing scheduler does inside its age window when no tag is preferred, because its dust rule (pending payout under 0.02) and its minimum weight are both 100 and a post a few minutes old is almost always dust by that rule; the scheduler's tag-yield estimate (`observe-tribe-curation-yield`) was not compared (it measures Hive-Engine tribe yield, a different quantity).

## Built

- `src/curation-curve.mjs`, `src/post-outcome.mjs`, `src/reward-predictor.mjs`, `src/shadow-curator.mjs`, `src/hive-post-source.mjs` (read-only: only `condenser_api.get_*`).
- `scripts/shadow-curator-cycle.mjs`: `fit-predictor`, `observe`, `settle`, `report`. Journal `<data>/journal.jsonl` holds decision rows and settle rows. Readiness is `assessShadowCurator` over the section `@red-cup-engineering/prediction-engineering-services-section`.
- `scripts/measure-curation-edge.mjs`, `scripts/collect-hive-post-universe.mjs`, `scripts/collect-hive-paid-curation.mjs`; data under `data/records/2026-10-19-hive-curation-measurement/`.

## Next steps

1. Run the cycle on Cold Red Gate: `fit-predictor` with the stored data (age 3600 s, fraction 0.5), then `observe` every 10 minutes (`--slack 600`) and `settle` daily. Needs a pulse in the Kalshi-style area, not a systemd timer. Report readiness after at least seven days of settled rows; backtest readiness does not authorize anything.
2. Collect a larger universe (the first run used about 1,000 posts over five days) and refit; the intervals are wide.
3. The two work orders `schedule-set-of-votes` and `run-hive-curation-cycle`: `curation-window-seconds` is now a derived claim from the measured `reverse-auction-window-hf25` (0 s) and the literal 300 is gone from the orders' defaults and tests. Still to do per the epistemic-law handoff: make the window a required input of the operation, read by the cycle from `condenser_api.get_config`; re-run `admit.mjs` and `check-order.mjs`; re-fabricate the two services from the amended orders.
4. Live voting: only after the Leader authorizes. The cast service (`cast-set-of-votes-service`) is untouched.
