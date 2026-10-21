# run-hive-curation-cycle
## Requirements
- `takes-curation-policy-as-data`: The operation takes `request.policy` (a plain curation policy object, never a file path), naming `accounts`, `tags`, `nodes`, `hiveEngineNode`, `postsPerTag`, the vote policy fields (`dailyManaBudgetPercent`, `minWeight`, `maxWeight`, `dustPendingPayoutThresholdHbd`, `dustWeight`, `preferredTags`, `neverVoteAuthors`, `curationWindowToleranceSeconds`, `maxDailyBudgetPercent`) and `journalRoot`; when `request.policy` is absent it runs the fleet strategy config's curation block (`curationPolicy` from `@red-cup-engineering/hive-fleet-operations-service/strategy`) for its curation-lane accounts, and `nodes` defaults to two independent public Hive nodes.
- `reads-the-curation-window-from-the-chain`: The operation reads the curation window as the chain's reverse auction window, `HIVE_REVERSE_AUCTION_WINDOW_SECONDS_HF25` from `condenser_api.get_config` on every node, once per cycle (or from `request.fixtures.config` in replay), and throws when the nodes do not agree or the value is not a finite number; it passes the value to `scheduleSetOfVotes` as `curationWindowSeconds` and never reads a window from the policy. [claims: reverse-auction-window-hf25, curation-window-seconds]
- `observes-then-schedules-then-casts`: For the policy's accounts and tags, the operation composes, in order and by exact pin, `@red-cup-engineering/observe-tribe-curation-yield-service`'s `observeTribeCurationYield` (a witnessed two-node read), then `@red-cup-engineering/schedule-set-of-votes-service`'s `scheduleSetOfVotes` per account, then `@red-cup-engineering/cast-set-of-votes-service`'s `castSetOfVotes` per account — never a fourth reimplementation of any of the three. [claims: the-three-are-composed]
- `plans-from-witnessed-reads`: The operation plans from the yield readout's witnessed `candidatePosts` and `curationPrice` and makes no ranked-post read of its own; each account's schedule is planned from them with the policy's vote fields.
- `confirms-casts-on-chain`: The operation forwards `request.sign`, `request.confirm`, the nodes and `request.fetchImpl` into `castSetOfVotes` and reports a vote as cast only when the composed call read it back from the chain; submissions it could not read back are counted as unconfirmed and never as executed.
- `journals-each-account-result`: For each policy account the operation puts one `hive-curation-cycle-account-result` record, category `cycle-account-result`, `{account,scheduledCount,confirmedCount,unconfirmedSubmissionCount,refusalReason,at}`, under `policy.journalRoot` through `@red-cup-engineering/semiotic-eavt-services-section/store`; the per-vote journal entries are written by the composed `castSetOfVotes` call, never duplicated here.
- `returns-run-record-version-two`: The operation returns a `HiveCurationCycleRunRecord` of version two `{type,version,runAt,yieldReadout,accounts:{[account]:{schedule,cast}},accounting}`; its `yieldReadout` names each candidate post it read by `{tag,symbol,author,permlink,created}` only, because the bodies and vote lists stay on chain.
- `leaves-income-to-the-ledger`: The operation books no curation income; its `accounting` field is a `HiveLedgerDerivationRequired` marker naming the accounts, because curation income is only settled and booked from chain history at `claim_reward_balance`.
- `supports-deterministic-replay`: The operation accepts optional `request.fetchImpl`, `request.fixtures` (threaded into the observation, with `fixtures.config` standing for the `condenser_api.get_config` result), `request.sign`, `request.confirm` and `request.now`, so a fully-injected request never touches the network or a signer.
- `runs-as-a-node-operation`: The operation is a JSNode operation run through `runJavascriptNodeOperation` from `@red-cup-engineering/javascript-node-operation-service`: it reads one JSON request per standard-input line and writes one JSON record per output line.
## Prohibitions
- `no-second-observe-schedule-cast`: The operation must not reimplement any behavior of `observeTribeCurationYield`, `scheduleSetOfVotes`, or `castSetOfVotes`; it only composes them. [claims: the-three-are-composed]
- `no-window-from-policy-or-literal`: The operation must not read the curation window from the policy, hold a literal for it, or fall back to a default when the chain's value is unavailable; the scheduled window is the chain's. [claims: reverse-auction-window-hf25, curation-window-seconds]
- `no-file-read-in-operation`: The operation must never open a file itself (no `node:fs`); the only state it writes is the journal put through the semiotic EAVT store, so every call stays a transformation of its input object and its injected ports. [claims: the-policy-arrives-as-data]
- `no-signing-or-key-read`: The operation must never read a posting key or construct a signer; signing stays in the injected or fleet signer behind the composed `castSetOfVotes` call. [claims: the-signer-is-inside-cast]
- `no-post-comment-follow-reblog-transfer`: The operation must never call any Hive write operation beyond what `castSetOfVotes` already casts (`vote` only). [claims: cast-votes-only]
## Laws
- `fabricate-do-not-hand-write` | 561 Group working discipline, dispatch-agents skill | 2026-09-04 | .claude/skills/dispatch-agents/SKILL.md | Applies to this whole operation source file. | The operation is born through the jsnode fabrication line from this work order, never hand-written; the fence below is the source the service repository holds.
- `no-automated-posting-fence` | Founder standing fence | 2026-09-04 | .claude/rules/working-discipline.md | Applies to the entire scope of this operation. | No automated posting or commenting from the founder's existing Hive accounts, ever; voting was never fenced, so this cycle observes, schedules, and casts votes only.
- `vote-budget-capped-until-policy-says-otherwise` | Operating constraint | 2026-09-05 | curation-services-section/data/state/hive-curation-policy-state/hive-curation-policy.json | Applies to the policy's `maxDailyBudgetPercent` and `maxWeight`. | The vote budget is capped at 20 percent of mana until the policy record changes. The default vote weight is lowered and can be raised through that policy record; the created record encodes both constraints.
## Standards
- `node-esm-operation` | Node.js | v24.2.0+ | https://nodejs.org/docs/v24/api/esm.html | Applies to the .mjs operation and its import.meta.main guard. | The package uses one executable ESM operation source file eligible for downstream staged package-birth assays.
- `hive-condenser-get-config` | Hive blockchain developer portal (condenser API) | 2026 revision | https://developers.hive.io/apidefinitions/ | Applies to the `reads-the-curation-window-from-the-chain` requirement. | The operation calls exactly `condenser_api.get_config` with no parameters and reads `HIVE_REVERSE_AUCTION_WINDOW_SECONDS_HF25` from its result on each node.
## Open questions
- `auxiliary-files-outside-the-fence` [nonblocking]: The service repository also holds `src/operations.mjs` (the `hive-curation-cycle` verb for the fleet's operation family, using `computer-system-engine`) and `scripts/execute-hive-curation-cycle.mjs` (the timer's one-shot) and their package exports and bin; a single-operation order cannot state them, so a follow-on order with module sources should.
- `unused-direct-dependencies` [nonblocking]: The package pins `computer-code-engineering-services-section`, `eavt-services-section`, `hive-blockchain-client-service` and `witness-journal-document-service` although the operation source imports none of them directly; a follow-on version may drop them or the operation may import them.
- `held-accounts-dropped` [nonblocking]: The first version of this order held accounts named in `policy.heldAccounts` and resolved a posting-key path per account; the service now judges each vote in the fleet signer and carries neither, so a hold must be stated again as a requirement if the Leader wants it.
## Claims
- `dep-observe-tribe-curation-yield-service` | measured | dependency | @red-cup-engineering/observe-tribe-curation-yield-service@0.1.2 is published on the Group registry | none | data/records/2026-10-19-work-order-evidence/npm-view-red-cup-engineering-observe-tribe-curation-yield-service-0-1-2.json | sha256:1fa96e7c13d76824b77e3ca841f1bb17c8aa751a449efbb0ecdce1e91d9e96d3 | npm view of @red-cup-engineering/observe-tribe-curation-yield-service@0.1.2 returned its name, version and integrity (2026-10-21)
- `dep-schedule-set-of-votes-service` | measured | dependency | @red-cup-engineering/schedule-set-of-votes-service@0.3.0 is published on the Group registry | none | data/records/2026-10-19-work-order-evidence/npm-view-red-cup-engineering-schedule-set-of-votes-service-0-3-0.json | sha256:c095bb2bf0ee7acd1a1a961766ea3d690c17780c9ea3e2efb7b1446602ceb92a | npm view of @red-cup-engineering/schedule-set-of-votes-service@0.3.0 returned its name, version and integrity (2026-10-21)
- `dep-cast-set-of-votes-service` | measured | dependency | @red-cup-engineering/cast-set-of-votes-service@0.1.2 is published on the Group registry | none | data/records/2026-10-19-work-order-evidence/npm-view-red-cup-engineering-cast-set-of-votes-service-0-1-2.json | sha256:4038f8f006cb9ccbb227d959de0a8c2d4626a1ce1c2d42edf32605f396de610e | npm view of @red-cup-engineering/cast-set-of-votes-service@0.1.2 returned its name, version and integrity (2026-10-21)
- `dep-computer-code-engineering-services-section` | measured | dependency | @red-cup-engineering/computer-code-engineering-services-section@0.1.2 is published on the Group registry | none | data/records/2026-10-19-work-order-evidence/npm-view-red-cup-engineering-computer-code-engineering-services-section-0-1-2.json | sha256:17b1a2ecb0e5fd9c6000b72fd15fca8c4b280462c389afcebe9eb878b5ec0bf3 | npm view of @red-cup-engineering/computer-code-engineering-services-section@0.1.2 returned its name, version and integrity (2026-10-21)
- `dep-semiotic-eavt-services-section` | measured | dependency | @red-cup-engineering/semiotic-eavt-services-section@0.1.0 is published on the Group registry | none | data/records/2026-10-19-work-order-evidence/npm-view-red-cup-engineering-semiotic-eavt-services-section-0-1-0.json | sha256:215fdd021c69786c848cf3ab7ed32e37e056de34f60669c16988f0f56d95cdba | npm view of @red-cup-engineering/semiotic-eavt-services-section@0.1.0 returned its name, version and integrity (2026-10-21)
- `dep-eavt-services-section` | measured | dependency | @red-cup-engineering/eavt-services-section@0.11.0 is published on the Group registry | none | data/records/2026-10-19-work-order-evidence/npm-view-red-cup-engineering-eavt-services-section-0-11-0.json | sha256:81294d6d9e4fe5482bc8fd4d6f58c02e12861a27b2dcfd9afd4e0fb8516a5901 | npm view of @red-cup-engineering/eavt-services-section@0.11.0 returned its name, version and integrity (2026-10-21)
- `dep-hive-blockchain-client-service` | measured | dependency | @red-cup-engineering/hive-blockchain-client-service@0.1.5 is published on the Group registry | none | data/records/2026-10-19-work-order-evidence/npm-view-red-cup-engineering-hive-blockchain-client-service-0-1-5.json | sha256:253cea583bd717049223c344a819213de263b4fa142706fbd713c567ae16af76 | npm view of @red-cup-engineering/hive-blockchain-client-service@0.1.5 returned its name, version and integrity (2026-10-21)
- `dep-witness-journal-document-service` | measured | dependency | @red-cup-engineering/witness-journal-document-service@0.1.2 is published on the Group registry | none | data/records/2026-10-19-work-order-evidence/npm-view-red-cup-engineering-witness-journal-document-service-0-1-2.json | sha256:26a5eaf24f5623980aa8cb0dcc02a4bfdd693890a9065f85a62b1e6862f43d6a | npm view of @red-cup-engineering/witness-journal-document-service@0.1.2 returned its name, version and integrity (2026-10-21)
- `dep-hive-fleet-operations-service` | measured | dependency | @red-cup-engineering/hive-fleet-operations-service@0.4.12 is published on the Group registry | none | data/records/2026-10-19-work-order-evidence/npm-view-red-cup-engineering-hive-fleet-operations-service-0-4-12.json | sha256:8519f66752ec535d8567254f8ab51a13b079d344f57fa24dc884519e7eac6650 | npm view of @red-cup-engineering/hive-fleet-operations-service@0.4.12 returned its name, version and integrity (2026-10-21)
- `dep-computer-system-engine` | measured | dependency | @red-cup-engineering/computer-system-engine@0.1.2 is published on the Group registry | none | data/records/2026-10-19-work-order-evidence/npm-view-red-cup-engineering-computer-system-engine-0-1-2.json | sha256:09a07608e0298b6194b9af0ccc536ad78717bd9317e9a4ff0be798b440da72d4 | npm view of @red-cup-engineering/computer-system-engine@0.1.2 returned its name, version and integrity (2026-10-21)
- `dep-javascript-node-operation-service` | measured | dependency | @red-cup-engineering/javascript-node-operation-service@0.1.0 is published on the Group registry | none | data/records/2026-10-19-work-order-evidence/npm-view-red-cup-engineering-javascript-node-operation-service-0-1-0.json | sha256:7ec276741c166ec7f8341385694adefb52cd156e08bc8fe8f8347b6dca1d3f8d | npm view of @red-cup-engineering/javascript-node-operation-service@0.1.0 returned its name, version and integrity (2026-10-21)
- `reverse-auction-window-hf25` | measured | parameter | From hardfork 25 the chain's reverse auction window, HIVE_REVERSE_AUCTION_WINDOW_SECONDS_HF25, is zero (it was 300 seconds at hardfork 21) | 0 s | data/records/2026-10-19-work-order-evidence/hive-get-config.json | sha256:9d2d3f0b604321d5f29dfcd84386303a13c2e78ee89d7dc01664bfcd81bcd9b8 | condenser_api.get_config returned HIVE_REVERSE_AUCTION_WINDOW_SECONDS_HF25 0 and _HF21 300 (2026-10-19)
- `curation-window-seconds` | derived | parameter | The age window inside which a vote's curation reward share can differ is the chain's reverse auction window, which is zero from hardfork 25, so a vote earns the full share from the post's creation | 0 s | claim:reverse-auction-window-hf25 | The window is the chain constant HIVE_REVERSE_AUCTION_WINDOW_SECONDS_HF25, measured as 0 s on 2026-10-19; no literal stands in for it
- `the-three-are-composed` | derived | world | Observing, scheduling and casting are done by the three pinned packages, which this operation composes in order | none | requirement:observes-then-schedules-then-casts; claim:dep-observe-tribe-curation-yield-service; claim:dep-schedule-set-of-votes-service; claim:dep-cast-set-of-votes-service | The requirement composes the three by exact pin, and each pin is on the registry, so reimplementing any of them is outside the order
- `the-policy-arrives-as-data` | derived | world | The policy reaches the operation as a plain object, so the operation has no reason to open a file | none | requirement:takes-curation-policy-as-data | The requirement takes the policy as data and its default comes from a pinned package, not from a file the operation opens
- `the-signer-is-inside-cast` | derived | world | The signer and the key read stay inside the composed cast call | none | requirement:observes-then-schedules-then-casts; requirement:confirms-casts-on-chain | The requirement hands the signer port to the composed cast and takes back only its confirmed result, never a key
- `cast-votes-only` | derived | world | The composed cast broadcasts votes only, so the cycle can call no other Hive write | none | requirement:observes-then-schedules-then-casts; claim:dep-cast-set-of-votes-service | The cast package at the pinned version casts one operation, a vote, and the cycle calls nothing else
## Package
```json
{"packageName":"@red-cup-engineering/run-hive-curation-cycle-service","packageVersion":"0.2.0","license":"UNLICENSED","dependencies":{"@red-cup-engineering/cast-set-of-votes-service":"0.1.2","@red-cup-engineering/computer-code-engineering-services-section":"0.1.2","@red-cup-engineering/semiotic-eavt-services-section":"0.1.0","@red-cup-engineering/eavt-services-section":"0.11.0","@red-cup-engineering/observe-tribe-curation-yield-service":"0.1.2","@red-cup-engineering/schedule-set-of-votes-service":"0.3.0","@red-cup-engineering/hive-blockchain-client-service":"0.1.5","@red-cup-engineering/witness-journal-document-service":"0.1.2","@red-cup-engineering/hive-fleet-operations-service":"0.4.12","@red-cup-engineering/computer-system-engine":"0.1.2","@red-cup-engineering/javascript-node-operation-service":"0.1.0"},"devDependencies":{}}
```
## Operation
```mjs path=scripts/run-hive-curation-cycle.mjs
#!/usr/bin/env node
import { observeTribeCurationYield } from "@red-cup-engineering/observe-tribe-curation-yield-service";
import { scheduleSetOfVotes } from "@red-cup-engineering/schedule-set-of-votes-service";
import { castSetOfVotes } from "@red-cup-engineering/cast-set-of-votes-service";
import { put } from "@red-cup-engineering/semiotic-eavt-services-section/store";
import { curationPolicy } from "@red-cup-engineering/hive-fleet-operations-service/strategy";
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
 * @param {object} [request.policy] The curation policy (default: the fleet strategy config's curation block, run for its curation-lane accounts).
 * @param {typeof fetch} [request.fetchImpl] Injectable fetch implementation, for tests.
 * @param {object} [request.fixtures] Literal pre-recorded read results, threaded into the two-node
 *   observation for deterministic replay; `fixtures.config` is the condenser_api.get_config result.
 * @param {Function} [request.sign] Injectable signer submission, forwarded into castSetOfVotes, for tests.
 * @param {Function} [request.confirm] Injectable chain confirmation, forwarded into castSetOfVotes.
 * @param {string} [request.now] An injectable ISO instant, for deterministic replay (default the real current time).
 * @returns {Promise<object>} A HiveCurationCycleRunRecord: {type,version,runAt,yieldReadout,accounts}.
 */
export async function runHiveCurationCycle(request = {}) {
  const policy = request.policy ?? curationPolicy();
  const fetchImpl = request.fetchImpl ?? fetch;
  const nowIso = request.now ?? new Date().toISOString();
  const nodes = policy.nodes ?? DEFAULT_NODES;

  const yieldReadout = await observeTribeCurationYield({
    nodes,
    hiveEngineNode: policy.hiveEngineNode,
    tags: policy.tags,
    postsPerTag: policy.postsPerTag,
    accounts: policy.accounts,
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
```
## Tests
```mjs path=test/run-hive-curation-cycle.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runHiveCurationCycle } from "../scripts/run-hive-curation-cycle.mjs";

const NOW = "2026-09-05T00:10:00.000Z";

function reply(payload) {
  return new Response(JSON.stringify(payload), { status: 200 });
}

function makeMockFetch({ postAgeSeconds }) {
  const created = new Date(new Date(NOW).getTime() - postAgeSeconds * 1000).toISOString().slice(0, -5);
  return async (input, init) => {
    const body = JSON.parse(init.body);
    if (body.method === "condenser_api.get_config") return reply({ result: { HIVE_REVERSE_AUCTION_WINDOW_SECONDS_HF25: 0 } });
    if (body.method === "condenser_api.get_dynamic_global_properties") return reply(({ result: { head_block_number: 100000 } }));
    if (body.method === "bridge.get_ranked_posts") {
      return reply(({ result: [{ author: "alice", permlink: "p1", created, category: "hive-167922", pending_payout_value: "0.500 HBD", net_rshares: "5000000", abs_rshares: "5000000", children: 3, author_reputation: "100000000000", json_metadata: "{}", active_votes: ["v1", "v2", "v3", "v4", "v5"].map((voter) => ({ voter, rshares: "1000000" })) }] }));
    }
    if (body.method === "find") return reply(({ result: [] }));
    if (body.method === "findOne") return reply(({ result: null }));
    if (body.method === "condenser_api.get_accounts") {
      return reply(({
          result: [{ voting_manabar: { current_mana: 1000000000000, last_update_time: Math.floor(new Date(NOW).getTime() / 1000) }, vesting_shares: "1000000.000000 VESTS", delegated_vesting_shares: "0.000000 VESTS", received_vesting_shares: "0.000000 VESTS" }],
        }));
    }
    throw new Error(`unmocked method ${body.method}`);
  };
}

function policy(overrides) {
  return {
    accounts: ["emsenn0"],
    tags: [{ name: "POB", tag: "proofofbrain", symbol: "POB" }],
    postsPerTag: 5,
    dailyManaBudgetPercent: 20,
    minWeight: 100,
    maxWeight: 3000,
    dustPendingPayoutThresholdHbd: "0.02",
    dustWeight: 100,
    preferredTags: ["proofofbrain"],
    neverVoteAuthors: [],
    curationWindowToleranceSeconds: 60,
    maxDailyBudgetPercent: 20,
    ...overrides,
  };
}

test("runs observe, schedule, and cast in one composed cycle and casts the one in-window candidate", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "run-hive-curation-cycle-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "emsenn0.wif"), "5Jtestwifvalue\n");

  const record = await runHiveCurationCycle({
    policy: policy({ journalRoot: root }),
    now: NOW,
    fetchImpl: makeMockFetch({ postAgeSeconds: 0 }),
    fixtures: { curationPrice: { hbdPerRshare: { num: 1n, den: 10_000_000n }, percentCurationRewards: 5000, votePowerReserveRate: 10 } },
    sign: async () => ({ status: "broadcast", id: "a".repeat(40) }),
    confirm: async () => [{ node: "https://api.hive.blog" }, { node: "https://api.openhive.network" }],
  });

  assert.equal(record.type, "HiveCurationCycleRunRecord");
  assert.equal(record.accounts.emsenn0.schedule.scheduled.length, 1);
  assert.equal(record.accounts.emsenn0.schedule.scheduled[0].weight, 3000);
  assert.equal(record.accounts.emsenn0.cast.cast.length, 1);
  assert.equal(record.accounts.emsenn0.cast.cast[0].transactionId, "a".repeat(40));
});

test("records the signer refusing a vote (but still schedules it)", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "run-hive-curation-cycle-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const record = await runHiveCurationCycle({
    policy: policy({ journalRoot: root }),
    now: NOW,
    fetchImpl: makeMockFetch({ postAgeSeconds: 0 }),
    fixtures: { curationPrice: { hbdPerRshare: { num: 1n, den: 10_000_000n }, percentCurationRewards: 5000, votePowerReserveRate: 10 } },
    sign: async () => { throw Object.assign(new Error("refused"), { refusal: { status: "refused", datum: "key-unavailable", reason: "no posting key is stored for @emsenn0" } }); },
  });

  assert.equal(record.accounts.emsenn0.cast.cast.length, 0);
  assert.equal(record.accounts.emsenn0.cast.refused[0].reason, "key-unavailable");
});


test("takes the curation window from the chain's config and refuses when the nodes disagree", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "run-hive-curation-cycle-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = makeMockFetch({ postAgeSeconds: 0 });
  let calls = 0;
  const disagreeing = async (input, init) => {
    const body = JSON.parse(init.body);
    if (body.method === "condenser_api.get_config") return reply({ result: { HIVE_REVERSE_AUCTION_WINDOW_SECONDS_HF25: calls++ === 0 ? 0 : 300 } });
    return base(input, init);
  };
  await assert.rejects(
    runHiveCurationCycle({ policy: policy({ journalRoot: root }), now: NOW, fetchImpl: disagreeing, fixtures: { curationPrice: { hbdPerRshare: { num: 1n, den: 10_000_000n }, percentCurationRewards: 5000, votePowerReserveRate: 10 } } }),
    /do not agree on HIVE_REVERSE_AUCTION_WINDOW_SECONDS_HF25/,
  );
});
```
## Examples
```json name="runs an empty-policy cycle (no tags, no accounts) and returns the empty-collections record shape"
{"input":{"policy":{"accounts":[],"tags":[],"nodes":["https://api.hive.blog","https://api.openhive.network"],"journalRoot":"/nonexistent","dailyManaBudgetPercent":20,"minWeight":100,"maxWeight":3000,"dustPendingPayoutThresholdHbd":"0.02","dustWeight":100,"preferredTags":[],"neverVoteAuthors":[],"curationWindowToleranceSeconds":60,"maxDailyBudgetPercent":20},"now":"2026-09-05T00:10:00.000Z","fixtures":{"dynamicGlobalProperties":{"https://api.hive.blog":{"head_block_number":100000},"https://api.openhive.network":{"head_block_number":100000}}}},"output":{"type":"HiveCurationCycleRunRecord","version":2,"runAt":"2026-09-05T00:10:00.000Z","yieldReadout":{"type":"TribeCurationYieldObservationRecord","version":2,"observedAt":"2026-09-05T00:10:00.000Z","witnesses":[{"node":"https://api.hive.blog","headBlockNumber":100000},{"node":"https://api.openhive.network","headBlockNumber":100000}],"tags":[],"accounts":{},"candidatePosts":[],"excludedCandidates":[],"curationPrice":null,"curationPriceWitnesses":[]},"accounts":{},"accounting":{"type":"HiveLedgerDerivationRequired","accounts":[],"reason":"curation income is only settled and booked from chain history at claim_reward_balance"}}}
```
## Traceability
- `takes-curation-policy-as-data` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `vote-budget-capped-until-policy-says-otherwise`
- `reads-the-curation-window-from-the-chain` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `hive-condenser-get-config`
- `observes-then-schedules-then-casts` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `no-automated-posting-fence`
- `plans-from-witnessed-reads` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `no-automated-posting-fence`
- `confirms-casts-on-chain` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `no-automated-posting-fence`
- `journals-each-account-result` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `no-automated-posting-fence`
- `returns-run-record-version-two` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `leaves-income-to-the-ledger` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `no-automated-posting-fence`
- `supports-deterministic-replay` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `runs-as-a-node-operation` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `no-second-observe-schedule-cast` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `no-automated-posting-fence`
- `no-window-from-policy-or-literal` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `hive-condenser-get-config`
- `no-file-read-in-operation` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `no-signing-or-key-read` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `no-automated-posting-fence`
- `no-post-comment-follow-reblog-transfer` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `no-automated-posting-fence`
