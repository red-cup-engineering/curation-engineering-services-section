/**
 * Predicts, from a post's state at a moment, whether a vote cast then will earn an ordinary curation reward, and ranks posts by it.
 * "Ordinary" is measured, not set: a reward at least `ordinaryFraction` of the training posts' median reward per unit. Pure.
 */
import { fitLogistic, predictLogistic } from "@red-cup-engineering/prediction-engineering-services-section/logistic";
import { featuresOf, realizedUnitReward, stateAt } from "./post-outcome.mjs";

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/**
 * @param {object[]} train HivePostOutcomeRecords
 * @param {{ageSeconds: number, multiplier: (age: number) => number, counterfactual: {ownRshares: number, fallbackRate: number}, ordinaryFraction: number, l2: number, iterations: number}} options the caller's
 */
export function fitRewardPredictor(train, { ageSeconds, multiplier, counterfactual, ordinaryFraction, l2, iterations }) {
  const rewards = train.map((p) => realizedUnitReward(p, ageSeconds, multiplier, counterfactual));
  const paying = rewards.filter((r) => r > 0);
  const reference = paying.length ? median(paying) : 0;
  const y = rewards.map((r) => (reference > 0 && r >= ordinaryFraction * reference ? 1 : 0));
  const model = y.some((v) => v === 1) && y.some((v) => v === 0) ? fitLogistic(train.map((p) => featuresOf(stateAt(p, ageSeconds))), y, { l2, iterations }) : null;
  return { type: "reward-predictor", ageSeconds, counterfactual, reference, ordinaryFraction, base: y.reduce((s, v) => s + v, 0) / Math.max(1, y.length), model, rows: train.length };
}

/** The probability a vote at the predictor's age on this post earns an ordinary reward. */
export function predictOrdinary(predictor, post) {
  return predictor.model ? predictLogistic(predictor.model, featuresOf(stateAt(post, predictor.ageSeconds))) : predictor.base;
}

/** The label the prediction is scored against: did the vote in fact earn an ordinary reward. */
export const earnedOrdinary = (predictor, post, multiplier) => (predictor.reference > 0 && realizedUnitReward(post, predictor.ageSeconds, multiplier, predictor.counterfactual) >= predictor.ordinaryFraction * predictor.reference ? 1 : 0);
