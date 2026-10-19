#!/usr/bin/env node
// Measures the curation reward curve and the walk-forward edge of the reward predictor over the baseline of voting on every candidate.
// node scripts/measure-curation-edge.mjs --paid <paid.jsonl> --universe <universe.jsonl>... --out <report.json>
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { clusterBootstrap } from "@red-cup-engineering/prediction-engineering-services-section/bootstrap";
import { foldsOf, walkForward } from "@red-cup-engineering/prediction-engineering-services-section/walk-forward";
import { assessClusteredEdge } from "@red-cup-engineering/prediction-engineering-services-section/readiness";
import { brierScore } from "@red-cup-engineering/prediction-engineering-services-section/forecast";
import { measureCurve, multiplierAt } from "../src/curation-curve.mjs";
import { counterfactualUnitReward, curatorRate, totalRate } from "../src/post-outcome.mjs";
import { earnedOrdinary, fitRewardPredictor, predictOrdinary } from "../src/reward-predictor.mjs";

const { values } = parseArgs({ options: { paid: { type: "string" }, universe: { type: "string", multiple: true }, out: { type: "string" }, folds: { type: "string", default: "4" }, alpha: { type: "string", default: "0.05" }, resamples: { type: "string", default: "2000" }, ages: { type: "string", default: "300,3600,21600" }, fractions: { type: "string", default: "0.25,0.5" }, ordinary: { type: "string", default: "0.5" }, own: { type: "string", default: "1e10" }, "min-payout": { type: "string", default: "0.02" } } });
const lines = (f) => readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const alpha = Number(values.alpha), resamples = Number(values.resamples), seed = 7;
const paid = lines(values.paid);
const curve = measureCurve(paid, { edges: [0, 43200, 86400, 108000, 129600, 172800, 259200, 345600, 432000, 604800, 800000], minRewarded: 3, alpha, resamples, seed });
const multiplier = (age) => multiplierAt(curve, age);
const posts = values.universe.flatMap(lines).sort((a, b) => (a.created < b.created ? -1 : 1));
const time = (p) => Date.parse(`${p.created}Z`);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const report = { type: "HiveCurationEdgeMeasurement", measuredAt: new Date().toISOString().slice(0, 10), curve, universe: { posts: posts.length, from: posts[0]?.created, to: posts.at(-1)?.created, paid: posts.filter((p) => p.paid).length, curatorsPaid: posts.filter((p) => curatorRate(p) > 0).length, declinedOrNoCuration: posts.filter((p) => !p.allowCuration || p.maxAccepted === 0).length }, alpha, resamples, results: [] };
const pools = posts.map(curatorRate).filter((x) => x > 0).sort((a, b) => a - b);
const totals = posts.map(totalRate).filter((x) => x > 0).sort((a, b) => a - b);
const counterfactual = { ownRshares: Number(values.own), fallbackRate: pools[Math.floor(pools.length / 2)], fallbackTotalRate: totals[Math.floor(totals.length / 2)], minPayoutHbd: Number(values["min-payout"]) };
report.counterfactual = counterfactual;
report.curatorRate = { median: pools[Math.floor(pools.length / 2)], p10: pools[Math.floor(pools.length * 0.1)], p90: pools[Math.floor(pools.length * 0.9)] };
for (const age of values.ages.split(",").map(Number)) for (const fraction of values.fractions.split(",").map(Number)) {
  const folds = foldsOf(time(posts[0]), time(posts.at(-1)) + 1, Number(values.folds));
  const out = walkForward(posts, { time, folds, fit: (train) => fitRewardPredictor(train, { ageSeconds: age, multiplier, counterfactual, ordinaryFraction: Number(values.ordinary), l2: 1, iterations: 50 }), evaluate: () => ({}) });
  // Within each held-out fold the top `fraction` by prediction is the would-vote set; the baseline votes on every candidate.
  const byFold = new Map();
  for (const { event, model } of out.heldOut) { const list = byFold.get(model) ?? []; list.push(event); byFold.set(model, list); }
  const clusters = [], scored = [];
  for (const [predictor, events] of byFold) {
    const ranked = events.map((post) => ({ post, p: predictOrdinary(predictor, post), y: counterfactualUnitReward(post, counterfactual) * multiplier(age), ordinary: earnedOrdinary(predictor, post, multiplier) })).sort((a, b) => b.p - a.p);
    const baseline = mean(ranked.map((r) => r.y)), take = Math.max(1, Math.ceil(ranked.length * fraction));
    ranked.forEach((r, i) => { scored.push(r); if (i < take) clusters.push({ y: r.y, baseline, reference: predictor.reference, pnl: predictor.reference > 0 ? (r.y - baseline) / predictor.reference : 0, units: 1 }); });
  }
  const ratio = (sample) => mean(sample.map((c) => c.y)) - mean(sample.map((c) => c.baseline));
  const interval = clusters.length ? clusterBootstrap(clusters, ratio, { resamples, alpha, seed }) : null;
  const readiness = assessClusteredEdge(clusters, { alpha, resamples, seed });
  report.results.push({ ageSeconds: age, selectFraction: fraction, heldOutPosts: scored.length, selected: clusters.length, baselineUnitReward: mean(scored.map((s) => s.y)), selectedUnitReward: mean(clusters.map((c) => c.y)), edge: mean(clusters.map((c) => c.y)) - mean(clusters.map((c) => c.baseline)), edgeInterval: interval, relativeEdge: mean(scored.map((s) => s.y)) > 0 ? (mean(clusters.map((c) => c.y)) / mean(scored.map((s) => s.y)) - 1) : null, ordinaryBase: mean(scored.map((s) => s.ordinary)), brier: mean(scored.map((s) => brierScore(Math.min(1, Math.max(0, s.p)), s.ordinary))), brierConstant: (() => { const b = mean(scored.map((s) => s.ordinary)); return mean(scored.map((s) => brierScore(b, s.ordinary))); })(), readiness: { pass: readiness.pass, checks: readiness.checks } });
}
writeFileSync(values.out, `${JSON.stringify(report, null, 1)}\n`);
console.log(JSON.stringify({ universe: report.universe, curve: curve.bins.map((b) => [b.from, b.median && +b.median.toFixed(3), b.votes]), results: report.results.map((r) => [r.ageSeconds, r.selectFraction, r.heldOutPosts, +r.relativeEdge?.toFixed(4), r.edgeInterval && [r.edgeInterval.lower, r.edgeInterval.upper].map((x) => +(x / r.baselineUnitReward).toFixed(4)), +r.ordinaryBase.toFixed(3), +r.brier.toFixed(4), +r.brierConstant.toFixed(4), r.readiness.pass]) }));
