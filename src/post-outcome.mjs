/**
 * What a Hive post became, and what was known of it at a moment. Pure. A HivePostOutcomeRecord is one root post with every vote it received
 * and its final payout fields, read from public API data after the payout window closed.
 */
const seconds = (iso) => Date.parse(`${iso}Z`) / 1000;

/** HBD paid to curators per net rshare of the post: the chain's linear rate, as the post itself realised it. 0 when it paid curators nothing. */
export function curatorRate(post) {
  const net = post.votes.reduce((s, v) => s + v.rshares, 0);
  return post.paid && post.allowCuration && post.curatorPayout > 0 && net > 0 ? post.curatorPayout / net : 0;
}

/** HBD paid in total (author, curators, beneficiaries) per net rshare of the post, as the post itself realised it; 0 when it paid nothing. */
export function totalRate(post) {
  const net = post.votes.reduce((s, v) => s + v.rshares, 0);
  return post.paid && post.totalPayout + post.curatorPayout > 0 && net > 0 ? (post.totalPayout + post.curatorPayout) / net : 0;
}

/**
 * What a unit rshare of our upvote would have earned on this post: the counterfactual of adding `ownRshares` to the votes it in fact received.
 * Rewards are linear in net rshares and shared pro rata among positive rshares, so our share of the curators' pool is
 * rate * max(0, net + own) * (own / (positive + own)) per own rshare. The chain pays a post only when its total reaches `minPayoutHbd`
 * (HIVE_MIN_PAYOUT_HBD), so a post whose payout with our vote added would fall short pays us nothing. A post that paid nothing has no rates of its
 * own; the caller supplies the measured medians (`fallbackRate`, `fallbackTotalRate`).
 */
export function counterfactualUnitReward(post, { ownRshares, fallbackRate, fallbackTotalRate, minPayoutHbd }) {
  if (!post.allowCuration || post.maxAccepted === 0) return 0;
  const net = post.votes.reduce((s, v) => s + v.rshares, 0), positive = post.votes.reduce((s, v) => s + Math.max(0, v.rshares), 0);
  if ((totalRate(post) || fallbackTotalRate) * Math.max(0, net + ownRshares) < minPayoutHbd) return 0;
  const rate = curatorRate(post) || fallbackRate;
  return (rate * Math.max(0, net + ownRshares)) / (positive + ownRshares);
}

/** HBD per own rshare for a vote cast at `ageSeconds`, given the measured age curve. */
export const realizedUnitReward = (post, ageSeconds, multiplier, counterfactual) => counterfactualUnitReward(post, counterfactual) * multiplier(ageSeconds);

/** The post as it stood `ageSeconds` after creation: only what a curator could have seen then. */
export function stateAt(post, ageSeconds) {
  const cutoff = seconds(post.created) + ageSeconds;
  const seen = post.votes.filter((v) => seconds(v.time) <= cutoff);
  const up = seen.reduce((s, v) => s + Math.max(0, v.rshares), 0), down = seen.reduce((s, v) => s + Math.max(0, -v.rshares), 0);
  const beneficiaryBps = (post.beneficiaries ?? []).reduce((s, b) => s + Number(b.weight ?? 0), 0);
  return {
    author: post.author, permlink: post.permlink, ageSeconds,
    votes: seen.length, upRshares: up, downRshares: down, downvoted: down > 0,
    allowCuration: Boolean(post.allowCuration), declined: post.maxAccepted === 0, powerUp: post.percentHbd === 0,
    beneficiaryBps, bodyLength: post.bodyLength, reputationOrder: Math.sign(post.authorReputation) * Math.log10(Math.max(1, Math.abs(post.authorReputation))),
  };
}

/** The feature row the predictor reads: nothing here is a threshold. */
export const featuresOf = (s) => [Math.log1p(s.votes), Math.log1p(s.upRshares), Math.log1p(s.downRshares), s.downvoted ? 1 : 0, s.allowCuration ? 1 : 0, s.declined ? 1 : 0, s.powerUp ? 1 : 0, s.beneficiaryBps / 10000, Math.log1p(s.bodyLength), s.reputationOrder];
