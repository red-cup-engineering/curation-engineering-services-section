/**
 * The curation reward curve, measured. A curator's reward per positive rshare, divided by the median of that ratio among the same post's
 * curators, is the vote's multiplier; binned by the vote's age at the time it was cast, it is the curve. Pure.
 * Inputs are PaidPostRecords: { created, votes: [{voter, time, rshares}], rewards: [{curator, vests}] } from the chain's curation_reward operations.
 */
import { clusterBootstrap } from "@red-cup-engineering/prediction-engineering-services-section/bootstrap";

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const seconds = (iso) => Date.parse(`${iso}Z`) / 1000;

/** Each rewarded upvote of a post as { age, multiplier }, the multiplier relative to the post's own median ratio. */
export function voteMultipliers(post, { minRewarded }) {
  const byVoter = new Map(post.votes.map((v) => [v.voter, v]));
  const rows = [];
  for (const reward of post.rewards) {
    const vote = byVoter.get(reward.curator);
    if (vote && vote.rshares > 0) rows.push({ age: seconds(vote.time) - seconds(post.created), ratio: reward.vests / vote.rshares });
  }
  if (rows.length < minRewarded) return [];
  const m = median(rows.map((r) => r.ratio));
  return rows.map((r) => ({ age: r.age, multiplier: r.ratio / m }));
}

/**
 * @param {object[]} posts PaidPostRecords
 * @param {{edges: number[], minRewarded: number, alpha: number, resamples: number, seed?: number}} options the caller's; `edges` are bin edges in seconds
 * @returns {{edges: number[], bins: {from: number, to: number, votes: number, posts: number, median: number, lower: number|null, upper: number|null}[]}}
 */
export function measureCurve(posts, { edges, minRewarded, alpha, resamples, seed = 1 }) {
  const perPost = posts.map((p) => voteMultipliers(p, { minRewarded })).filter((v) => v.length);
  const bins = [];
  for (let i = 0; i + 1 < edges.length; i += 1) {
    const [from, to] = [edges[i], edges[i + 1]];
    const clusters = perPost.map((votes) => votes.filter((v) => v.age >= from && v.age < to).map((v) => v.multiplier)).filter((v) => v.length).map((multipliers) => ({ multipliers }));
    const all = clusters.flatMap((c) => c.multipliers);
    const interval = clusters.length >= 2 ? clusterBootstrap(clusters, (sample) => median(sample.flatMap((c) => c.multipliers)), { resamples, alpha, seed }) : null;
    bins.push({ from, to, votes: all.length, posts: clusters.length, median: all.length ? median(all) : null, lower: interval?.lower ?? null, upper: interval?.upper ?? null });
  }
  return { edges, bins };
}

/** The multiplier of a vote cast at `ageSeconds`: the measured median of the bin it falls in; none beyond the last edge. */
export function multiplierAt(curve, ageSeconds) {
  const bin = curve.bins.find((b) => ageSeconds >= b.from && ageSeconds < b.to && b.median !== null);
  return bin ? bin.median : 0;
}
