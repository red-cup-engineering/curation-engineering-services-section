#!/usr/bin/env node
// The Hive shadow curator, one command per step. It records would-vote decisions and the rewards they would have earned; it never votes.
//   observe   read recent root posts and append a decision row for each candidate at the predictor's age
//   settle    for decisions whose payout window has closed, append what the vote would have earned
//   report    the readiness verdict over the journal
// State: <data>/predictor.json (from fit-predictor) and the SEAVT shadow log.
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { measureCurve, multiplierAt } from "../src/curation-curve.mjs";
import { outcomeRecord, readRootPostsSince, readRpc } from "../src/hive-post-source.mjs";
import { fitRewardPredictor } from "../src/reward-predictor.mjs";
import { assessShadowCurator, decideShadowVotes, settleShadowVote } from "../src/shadow-curator.mjs";
import { appendShadowRows, readShadowRows, sealShadowRows } from "../src/shadow-curator-journal.mjs";

const text = (f) => (f.endsWith(".gz") ? gunzipSync(readFileSync(f)).toString("utf8") : readFileSync(f, "utf8"));
const lines = (f) => (existsSync(f) ? text(f).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const NODES = ["https://api.hive.blog", "https://api.deathwing.me", "https://api.openhive.network"];
const seconds = (iso) => Date.parse(`${iso}Z`) / 1000;

export async function run(argv, { fetchImpl = fetch, now = () => new Date(), settlementLimit = Infinity, settlementOffset = 0 } = {}) {
  const [command, ...rest] = argv;
  const { values } = parseArgs({ args: rest, options: { data: { type: "string" }, paid: { type: "string" }, universe: { type: "string", multiple: true }, age: { type: "string" }, slack: { type: "string" }, fraction: { type: "string" }, own: { type: "string" }, "min-payout": { type: "string", default: "0.02" }, alpha: { type: "string", default: "0.05" }, resamples: { type: "string", default: "2000" }, "payout-window": { type: "string", default: "604800" } } });
  const predictorFile = join(values.data, "predictor.json");
  if (command === "fit-predictor") {
    const edges = [0, 43200, 86400, 108000, 129600, 172800, 259200, 345600, 432000, 604800, 800000];
    const curve = measureCurve(lines(values.paid), { edges, minRewarded: 3, alpha: Number(values.alpha), resamples: Number(values.resamples), seed: 7 });
    const posts = values.universe.flatMap(lines);
    const rates = posts.map((p) => p.curatorPayout / p.votes.reduce((s, v) => s + v.rshares, 0)).filter((x) => x > 0 && Number.isFinite(x)).sort((a, b) => a - b);
    const totals = posts.map((p) => (p.totalPayout + p.curatorPayout) / p.votes.reduce((s, v) => s + v.rshares, 0)).filter((x) => x > 0 && Number.isFinite(x)).sort((a, b) => a - b);
    const counterfactual = { ownRshares: Number(values.own), fallbackRate: rates[Math.floor(rates.length / 2)], fallbackTotalRate: totals[Math.floor(totals.length / 2)], minPayoutHbd: Number(values["min-payout"]) };
    const predictor = fitRewardPredictor(posts, { ageSeconds: Number(values.age), multiplier: (a) => multiplierAt(curve, a), counterfactual, ordinaryFraction: 0.5, l2: 1, iterations: 50 });
    writeFileSync(predictorFile, `${JSON.stringify({ predictor, curve, selectFraction: Number(values.fraction) })}\n`);
    return { fitted: posts.length };
  }
  const { predictor, curve, selectFraction } = JSON.parse(readFileSync(predictorFile, "utf8"));
  const multiplier = (a) => multiplierAt(curve, a);
  if (command === "observe") {
    const seen = new Set(readShadowRows(values.data).filter((r) => r.kind === "decision").map((r) => `${r.author}/${r.permlink}`));
    const nowSeconds = now().getTime() / 1000;
    const discussions = await readRootPostsSince({ nodes: NODES, since: nowSeconds - predictor.ageSeconds - Number(values.slack), fetchImpl });
    const candidates = discussions.map(outcomeRecord).filter((p) => { const age = nowSeconds - seconds(p.created); return age >= predictor.ageSeconds && age < predictor.ageSeconds + Number(values.slack) && !seen.has(`${p.author}/${p.permlink}`); });
    if (candidates.length === 0) return { decided: 0 };
    const observedAt = now();
    const rows = decideShadowVotes(candidates, predictor, { decidedAt: observedAt.toISOString(), selectFraction });
    appendShadowRows(values.data, rows, observedAt.toISOString());
    sealShadowRows(values.data, observedAt);
    return { decided: rows.length, wouldVote: rows.filter((r) => r.wouldVote).length };
  }
  if (command === "settle") {
    const rows = readShadowRows(values.data);
    const finished = new Set(rows.filter((r) => r.kind === "settle" || r.kind === "unavailable").map((r) => `${r.author}/${r.permlink}`));
    const payoutCutoff = now().getTime() / 1000 - Number(values["payout-window"]) - 3600;
    const due = rows.filter((r) => r.kind === "decision" && !finished.has(`${r.author}/${r.permlink}`) && seconds(r.created) < payoutCutoff);
    let settled = 0, unavailable = 0, unpaid = 0, failed = 0, consecutiveFailures = 0, firstError;
    for (const d of due.slice(settlementOffset, settlementOffset + settlementLimit)) {
      let content;
      try {
        content = await readRpc({ nodes: NODES, method: "condenser_api.get_content", params: [d.author, d.permlink], fetchImpl });
      } catch (error) {
        failed += 1;
        firstError ??= error.message;
        // Leave a shared RPC outage for the next cycle instead of exhausting every timeout.
        if (++consecutiveFailures >= 3) break;
        continue;
      }
      consecutiveFailures = 0;
      if (content === null) {
        const observedAt = now().toISOString();
        appendShadowRows(values.data, [{ kind: "unavailable", author: d.author, permlink: d.permlink, observedAt }], observedAt);
        unavailable += 1;
        continue;
      }
      const post = outcomeRecord(content);
      if (!post.paid) {
        unpaid += 1;
        continue;
      }
      const settledAt = now().toISOString();
      appendShadowRows(values.data, [{ ...settleShadowVote(d, post, predictor, multiplier), settledAt }], settledAt);
      settled += 1;
    }
    sealShadowRows(values.data, now());
    const attempted = settled + unavailable + unpaid + failed;
    // Terminal rows exit the next pass's due list. Deferred rows still occupy their offsets.
    const nextOffset = settlementOffset + attempted < due.length ? settlementOffset + unpaid + failed : null;
    return { settled, due: due.length, unavailable, unpaid, failed, firstError, nextOffset };
  }
  if (command === "report") return assessShadowCurator(readShadowRows(values.data), { alpha: Number(values.alpha), resamples: Number(values.resamples), seed: 7 });
  throw new TypeError("commands: fit-predictor, observe, settle, report");
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { process.stdout.write(`${JSON.stringify(await run(process.argv.slice(2)), null, 1)}\n`); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
