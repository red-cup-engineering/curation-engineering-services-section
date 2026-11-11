#!/usr/bin/env node
import { observeTribeCurationYield } from "@red-cup-engineering/observe-tribe-curation-yield-service";
import { scheduleSetOfVotes } from "@red-cup-engineering/schedule-set-of-votes-service";
import { castSetOfVotes } from "@red-cup-engineering/cast-set-of-votes-service";
import { put } from "@red-cup-engineering/semiotic-eavt-services-section/store";
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-operation-service";

const DEFAULT_NODES = Object.freeze(["https://api.hive.blog", "https://api.openhive.network"]);

/**
 * Reads the chain's reverse auction window (HIVE_REVERSE_AUCTION_WINDOW_SECONDS_HF25) from condenser_api.get_config
 * on every node and requires them to agree; the cycle holds no literal for it.
 * @param {readonly string[]} nodes
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<number>}
 */
async function readReverseAuctionWindowSeconds(nodes, fetchImpl) {
  const values = [];
  for (const node of nodes) {
    const response = await fetchImpl(node, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_config", params: [], id: 1 }) });
    const config = (await response.json()).result;
    values.push(Number(config?.HIVE_REVERSE_AUCTION_WINDOW_SECONDS_HF25));
  }
  if (values.length === 0 || values.some((value) => !Number.isFinite(value) || value !== values[0])) throw new Error(`run-hive-curation-cycle: the nodes do not agree on HIVE_REVERSE_AUCTION_WINDOW_SECONDS_HF25 (${values.join(", ")})`);
  return values[0];
}

/**
 * Runs one Hive curation cycle for every policy account.  It only plans from two-node witnessed
 * candidate posts and price data, and only reports a vote as executed once two nodes read back its
 * exact chain operation.  Curation income remains the Hive ledger's later claim-derived fact.
 * @param {object} request
 * @param {object} request.policy The curation policy, including the host's absolute `journalRoot`.
 * @param {typeof fetch} [request.fetchImpl] Injectable fetch implementation, for tests.
 * @param {object} [request.fixtures] Literal pre-recorded read results, threaded into the two-node
 *   observation for deterministic replay; `fixtures.config` is the condenser_api.get_config result.
 * @param {Function} [request.sign] Injectable signer submission, forwarded into castSetOfVotes, for tests.
 * @param {Function} [request.confirm] Injectable chain confirmation, forwarded into castSetOfVotes.
 * @param {string} [request.now] An injectable ISO instant, for deterministic replay (default the real current time).
 * @returns {Promise<object>} A HiveCurationCycleRunRecord: {type,version,runAt,yieldReadout,accounts}.
 */
export async function runHiveCurationCycle(request = {}) {
  // The policy, including where this host keeps the cycle journal, is data from the caller; the
  // operation never reads a policy file or chooses a host path itself.
  const policy = request.policy;
  if (!policy || typeof policy !== "object") throw new TypeError("run-hive-curation-cycle: request.policy is required");
  if (typeof policy.journalRoot !== "string" || !policy.journalRoot.startsWith("/"))
    throw new TypeError("run-hive-curation-cycle: policy.journalRoot must be the host's absolute journal directory");
  const fetchImpl = request.fetchImpl ?? fetch;
  const nowIso = request.now ?? new Date().toISOString();
  const nodes = policy.nodes ?? DEFAULT_NODES;

  const yieldReadout = await observeTribeCurationYield({
    nodes,
    hiveEngineNode: policy.hiveEngineNode,
    tags: policy.tags,
    postsPerTag: policy.postsPerTag,
    accounts: activeAccounts,
    now: nowIso,
    fetchImpl,
    fixtures: request.fixtures,
  });

  const candidatePosts = yieldReadout.candidatePosts;
  const price = yieldReadout.curationPrice ?? undefined;
  const accounts = {};
  let curationWindowSeconds;
  for (const account of policy.accounts) {
    // The window is the chain's own constant, read once per cycle.
    curationWindowSeconds ??= request.fixtures?.config ? Number(request.fixtures.config.HIVE_REVERSE_AUCTION_WINDOW_SECONDS_HF25) : await readReverseAuctionWindowSeconds(nodes, fetchImpl);
    const schedule = scheduleSetOfVotes({
      curationWindowSeconds,
      yieldReadout,
      account,
      candidatePosts,
      price,
      policy: {
        dailyManaBudgetPercent: policy.dailyManaBudgetPercent,
        minWeight: policy.minWeight,
        maxWeight: policy.maxWeight,
        dustPendingPayoutThresholdHbd: policy.dustPendingPayoutThresholdHbd,
        dustWeight: policy.dustWeight,
        preferredTags: policy.preferredTags,
        neverVoteAuthors: policy.neverVoteAuthors,
        curationWindowToleranceSeconds: policy.curationWindowToleranceSeconds,
      },
      now: nowIso,
    });
    const cast = await castSetOfVotes({
      schedule,
      account,
      journalRoot: policy.journalRoot,
      maxDailyBudgetPercent: policy.maxDailyBudgetPercent,
      sign: request.sign,
      confirm: request.confirm,
      nodes,
      fetchImpl,
      now: nowIso,
    });
    put(policy.journalRoot, "hive-curation-cycle-account-result", { category: "cycle-account-result", ...{
        account,
        scheduledCount: schedule.scheduled.length,
        confirmedCount: cast.cast.length,
        unconfirmedSubmissionCount: cast.unconfirmed.length,
        refusalReason: cast.refusal?.reason ?? null,
      }, at: nowIso });
    accounts[account] = { schedule, cast };
  }

  return {
    type: "HiveCurationCycleRunRecord",
    version: 2,
    runAt: nowIso,
    // The cycle record names the posts it read; their bodies and vote lists stay on chain.
    yieldReadout: { ...yieldReadout, candidatePosts: candidatePosts.map(({ tag, symbol, post }) => ({ tag, symbol, author: post.author, permlink: post.permlink, created: post.created })) },
    accounts,
    accounting: {
      type: "HiveLedgerDerivationRequired",
      accounts: Object.keys(accounts),
      reason: "curation income is only settled and booked from chain history at claim_reward_balance",
    },
  };
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "run-hive-curation-cycle", description: "Runs one Hive curation cycle for every policy account, taking the founder's policy record as data, observing tribe curation yield, scheduling votes, and casting them.", operation: runHiveCurationCycle }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
