/**
 * The shadow curator: records which posts it would vote on, and later what those votes would have earned. It holds no key, signs nothing,
 * broadcasts nothing and imports no vote-casting code: a live vote spends real voting power and needs the Leader's authorisation after
 * readiness passes. Pure; the journal, the network and the clock belong to scripts/shadow-curator-cycle.mjs.
 */
import { assessClusteredEdge } from "@red-cup-engineering/prediction-engineering-services-section/readiness";
import { brierScore, logScore } from "@red-cup-engineering/prediction-engineering-services-section/forecast";
import { earnedOrdinary, predictOrdinary } from "./reward-predictor.mjs";
import { realizedUnitReward } from "./post-outcome.mjs";

/**
 * One decision row per candidate: every candidate is recorded so that calibration and the edge over voting on all of them can be scored.
 * The `selectFraction` of candidates with the highest predicted chance are the would-vote set.
 */
export function decideShadowVotes(candidates, predictor, { decidedAt, selectFraction }) {
  if (!(selectFraction > 0 && selectFraction <= 1)) throw new RangeError("decideShadowVotes needs selectFraction in (0,1]");
  const scored = candidates.map((post) => ({ post, predicted: predictOrdinary(predictor, post) })).sort((a, b) => b.predicted - a.predicted);
  const take = Math.max(1, Math.ceil(scored.length * selectFraction));
  return scored.map(({ post, predicted }, rank) => ({ kind: "decision", author: post.author, permlink: post.permlink, created: post.created, decidedAt, ageSeconds: predictor.ageSeconds, predicted, rank, selected: rank < take, wouldVote: rank < take }));
}

/** What the decision's vote would have earned, per unit rshare, once the post's payout is final. */
export function settleShadowVote(decision, finalPost, predictor, multiplier) {
  const unitReward = realizedUnitReward(finalPost, predictor.ageSeconds, multiplier, predictor.counterfactual);
  return { kind: "settle", author: decision.author, permlink: decision.permlink, unitReward, ordinary: earnedOrdinary(predictor, finalPost, multiplier), reference: predictor.reference };
}

/**
 * Readiness of the shadow curator from its journal rows: calibration scores of every settled decision, and the one-sided bootstrap bound on
 * the selected votes' reward over the average candidate's, as a fraction of the ordinary reward. Pure.
 */
export function assessShadowCurator(rows, { alpha, resamples, seed = 1 }) {
  const settles = new Map(rows.filter((r) => r.kind === "settle").map((r) => [`${r.author}/${r.permlink}`, r]));
  const joined = rows.filter((r) => r.kind === "decision").map((d) => ({ d, s: settles.get(`${d.author}/${d.permlink}`) })).filter(({ s }) => s);
  if (joined.length === 0) return { pass: false, settled: 0, checks: { evidence: { pass: false, value: 0, need: "settled decisions" } } };
  const reference = joined[0].s.reference;
  const mean = joined.reduce((t, { s }) => t + s.unitReward, 0) / joined.length;
  const selected = joined.filter(({ d }) => d.selected);
  const edge = assessClusteredEdge(selected.map(({ s }) => ({ pnl: reference > 0 ? (s.unitReward - mean) / reference : 0, units: 1 })), { alpha, resamples, seed });
  const brier = joined.reduce((t, { d, s }) => t + brierScore(d.predicted, s.ordinary), 0) / joined.length;
  const clip = (p) => Math.min(1 - 1e-9, Math.max(1e-9, p));
  const log = joined.reduce((t, { d, s }) => t + logScore(clip(d.predicted), s.ordinary), 0) / joined.length;
  return { ...edge, settled: joined.length, selected: selected.length, meanUnitReward: mean, brier, logScore: log };
}
