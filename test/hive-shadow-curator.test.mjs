import assert from "node:assert/strict";
import test from "node:test";
import { measureCurve, multiplierAt, voteMultipliers } from "../src/curation-curve.mjs";
import { counterfactualUnitReward, curatorRate, stateAt } from "../src/post-outcome.mjs";
import { fitRewardPredictor, predictOrdinary } from "../src/reward-predictor.mjs";
import { assessShadowCurator, decideShadowVotes, settleShadowVote } from "../src/shadow-curator.mjs";

const post = (n, over = {}) => ({
  author: `a${n}`, permlink: `p${n}`, created: `2026-10-0${1 + (n % 7)}T00:00:00`, paid: true, allowCuration: true, maxAccepted: 1e6, percentHbd: 10000, beneficiaries: [], bodyLength: 500, authorReputation: 1e12, curatorPayout: 1, totalPayout: 1,
  votes: [{ voter: "x", time: `2026-10-0${1 + (n % 7)}T00:05:00`, rshares: 1e10 }, { voter: "y", time: `2026-10-0${1 + (n % 7)}T02:00:00`, rshares: 1e10 }], ...over,
});

test("the curator rate is the curators' pool per net rshare, and zero when curators were not paid", () => {
  assert.equal(curatorRate(post(1)), 1 / 2e10);
  assert.equal(curatorRate(post(1, { curatorPayout: 0 })), 0);
  assert.equal(curatorRate(post(1, { allowCuration: false })), 0);
});

test("our counterfactual vote earns the rate on an ordinary post, the rate on an unvoted one, and nothing where rewards are declined or downvotes cancel it", () => {
  const cf = { ownRshares: 1e10, fallbackRate: 5e-11, fallbackTotalRate: 1e-10, minPayoutHbd: 0 };
  const ordinary = counterfactualUnitReward(post(1), cf);
  assert.ok(Math.abs(ordinary - (1 / 2e10) * (3e10 / 3e10)) < 1e-15);
  assert.equal(counterfactualUnitReward(post(2, { votes: [], curatorPayout: 0 }), cf), 5e-11);
  assert.equal(counterfactualUnitReward(post(3, { maxAccepted: 0 }), cf), 0);
  const cancelled = post(4, { curatorPayout: 0, votes: [{ voter: "x", time: "2026-10-01T00:05:00", rshares: 1e10 }, { voter: "z", time: "2026-10-01T01:00:00", rshares: -9e10 }] });
  assert.equal(counterfactualUnitReward(cancelled, cf), 0);
});

test("stateAt shows only what had happened by then", () => {
  const p = post(1);
  assert.equal(stateAt(p, 60).votes, 0);
  assert.equal(stateAt(p, 600).votes, 1);
  assert.equal(stateAt(p, 86400).votes, 2);
});

test("the measured curve gives each vote its multiplier against its post's median and bins by age", () => {
  const paid = Array.from({ length: 6 }, (_, i) => ({ created: "2026-10-01T00:00:00", votes: [{ voter: "a", time: "2026-10-01T00:10:00", rshares: 100 }, { voter: "b", time: "2026-10-01T00:20:00", rshares: 100 }, { voter: "c", time: "2026-10-02T12:00:00", rshares: 100 }], rewards: [{ curator: "a", vests: 1 }, { curator: "b", vests: 1 }, { curator: "c", vests: 0.5 }] }));
  assert.equal(voteMultipliers(paid[0], { minRewarded: 4 }).length, 0);
  const curve = measureCurve(paid, { edges: [0, 86400, 259200], minRewarded: 3, alpha: 0.05, resamples: 200 });
  assert.equal(curve.bins[0].median, 1); assert.equal(curve.bins[1].median, 0.5);
  assert.equal(multiplierAt(curve, 100), 1); assert.equal(multiplierAt(curve, 100000), 0.5); assert.equal(multiplierAt(curve, 9e9), 0);
});

test("the predictor ranks a post whose rewards are declined below ordinary posts, and the shadow curator records every candidate", () => {
  const multiplier = () => 1, counterfactual = { ownRshares: 1e10, fallbackRate: 5e-11, fallbackTotalRate: 1e-10, minPayoutHbd: 0.02 };
  const train = Array.from({ length: 60 }, (_, i) => post(i, i % 3 === 0 ? { maxAccepted: 0, curatorPayout: 0 } : {}));
  const predictor = fitRewardPredictor(train, { ageSeconds: 600, multiplier, counterfactual, ordinaryFraction: 0.5, l2: 1, iterations: 40 });
  assert.ok(predictOrdinary(predictor, post(100)) > predictOrdinary(predictor, post(101, { maxAccepted: 0 })));
  const candidates = [post(100), post(101, { maxAccepted: 0 }), post(102), post(103)];
  const rows = decideShadowVotes(candidates, predictor, { decidedAt: "2026-10-09T00:00:00Z", selectFraction: 0.5 });
  assert.equal(rows.length, 4);
  assert.equal(rows.filter((r) => r.wouldVote).length, 2);
  assert.ok(rows.every((r) => r.kind === "decision" && !("signature" in r)));
  assert.throws(() => decideShadowVotes(candidates, predictor, { decidedAt: "x", selectFraction: 0 }), RangeError);
  const settles = rows.map((d) => settleShadowVote(d, candidates.find((c) => c.permlink === d.permlink), predictor, multiplier));
  const verdict = assessShadowCurator([...rows, ...settles], { alpha: 0.05, resamples: 200 });
  assert.equal(verdict.settled, 4);
  assert.equal(verdict.pass, false, "four settled decisions never pass readiness");
  assert.equal(verdict.checks.evidence.pass, false);
});

test("a shadow curator module imports no signing or broadcasting code", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["shadow-curator", "reward-predictor", "post-outcome", "curation-curve"]) assert.doesNotMatch(readFileSync(new URL(`../src/${f}.mjs`, import.meta.url), "utf8"), /from\s+["'][^"']*(cast-set-of-votes|signer|broadcast|keychain)[^"']*["']/u);
});

test("the cycle observes candidates at the predictor's age, records them, and settles them once the payout window has closed, with no write call", async () => {
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { run } = await import("../scripts/shadow-curator-cycle.mjs");
  const data = mkdtempSync(join(tmpdir(), "shadow-"));
  const multiplierCurve = { edges: [0, 1e9], bins: [{ from: 0, to: 1e9, votes: 9, posts: 9, median: 1, lower: 1, upper: 1 }] };
  const train = Array.from({ length: 40 }, (_, i) => post(i, i % 4 === 0 ? { maxAccepted: 0, curatorPayout: 0 } : {}));
  const { fitRewardPredictor: fit } = await import("../src/reward-predictor.mjs");
  const predictor = fit(train, { ageSeconds: 600, multiplier: () => 1, counterfactual: { ownRshares: 1e10, fallbackRate: 5e-11, fallbackTotalRate: 1e-10, minPayoutHbd: 0.02 }, ordinaryFraction: 0.5, l2: 1, iterations: 40 });
  writeFileSync(join(data, "predictor.json"), JSON.stringify({ predictor, curve: multiplierCurve, selectFraction: 0.5 }));
  const created = "2026-10-01T00:00:00";
  const discussion = (n) => ({ author: `w${n}`, permlink: `q${n}`, created, category: "x", json_metadata: "{}", last_payout: "1970-01-01T00:00:00", total_payout_value: "0.000 HBD", curator_payout_value: "0.000 HBD", pending_payout_value: "1.000 HBD", max_accepted_payout: n === 1 ? "0.000 HBD" : "1000000.000 HBD", allow_curation_rewards: true, percent_hbd: 10000, beneficiaries: [], author_reputation: "1000000000000", body: "x".repeat(400), net_rshares: "0", active_votes: [] });
  const calls = [];
  const fetchImpl = async (_node, init) => { const body = JSON.parse(init.body); calls.push(body.method); const paid = body.method === "condenser_api.get_content"; return { json: async () => ({ result: paid ? { ...discussion(0), last_payout: "2026-10-08T00:00:00", curator_payout_value: "0.5 HBD", net_rshares: "2", active_votes: [{ voter: "v", time: "2026-10-01T00:01:00", rshares: 1e10, percent: 1 }] } : [discussion(0), discussion(1), discussion(2), discussion(3)] }) }; };
  const at = (iso) => () => new Date(iso);
  const observed = await run(["observe", "--data", data, "--slack", "600"], { fetchImpl, now: at("2026-10-01T00:12:00Z") });
  assert.deepEqual(observed, { decided: 4, wouldVote: 2 });
  assert.deepEqual(await run(["observe", "--data", data, "--slack", "600"], { fetchImpl, now: at("2026-10-01T00:13:00Z") }), { decided: 0 }, "a post is decided once");
  assert.deepEqual(await run(["settle", "--data", data], { fetchImpl, now: at("2026-10-03T00:00:00Z") }), { settled: 0, due: 0 });
  const settled = await run(["settle", "--data", data], { fetchImpl, now: at("2026-10-10T00:00:00Z") });
  assert.equal(settled.settled, 4);
  assert.ok(calls.every((m) => m.startsWith("condenser_api.get_")));
  const verdict = await run(["report", "--data", data, "--resamples", "100"], {});
  assert.equal(verdict.settled, 4);
  assert.equal(JSON.parse(readFileSync(join(data, "journal.jsonl"), "utf8").trim().split("\n")[0]).kind, "decision");
});

test("a post that could not reach the chain's minimum payout even with our vote earns us nothing", () => {
  const cf = { ownRshares: 1e10, fallbackRate: 5e-14, fallbackTotalRate: 1e-13, minPayoutHbd: 0.02 };
  assert.equal(counterfactualUnitReward(post(5, { votes: [], curatorPayout: 0, totalPayout: 0 }), cf), 0, "1e10 rshares at 1e-13 HBD each is 0.001 HBD, under the minimum");
  assert.ok(counterfactualUnitReward(post(5, { votes: [], curatorPayout: 0, totalPayout: 0 }), { ...cf, ownRshares: 1e12 }) > 0);
});
