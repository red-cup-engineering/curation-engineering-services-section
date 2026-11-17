import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runHiveCurationCycle } from "../scripts/run-hive-curation-cycle.mjs";

test("held accounts are excluded from both observation and the casting cycle", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "hive-hold-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const now = "2026-11-17T03:00:00.000Z";
  const nodes = ["https://api.hive.blog", "https://api.openhive.network"];
  const account = {
    voting_manabar: { current_mana: 1e12, last_update_time: Date.parse(now) / 1000 },
    vesting_shares: "1000000.000000 VESTS",
    delegated_vesting_shares: "0.000000 VESTS",
    received_vesting_shares: "0.000000 VESTS",
  };
  const post = {
    author: "external-author",
    permlink: "independent-post",
    created: now.slice(0, 19),
    pending_payout_value: "0.500 HBD",
    net_rshares: "5000000",
    abs_rshares: "5000000",
    children: 3,
    author_reputation: "100000000000",
    json_metadata: "{}",
    active_votes: ["v1", "v2", "v3", "v4", "v5"].map((voter) => ({ voter, rshares: "1000000" })),
  };
  const submitted = [];
  const result = await runHiveCurationCycle({
    policy: {
      journalRoot: root,
      accounts: ["emsenn0", "michael561"],
      heldAccounts: ["emsenn0"],
      nodes,
      tags: [{ name: "Hive", tag: "hive", symbol: null }],
      dailyManaBudgetPercent: 20,
      maxDailyBudgetPercent: 20,
      minWeight: 100,
      maxWeight: 3000,
      dustPendingPayoutThresholdHbd: "0.02",
      dustWeight: 100,
      preferredTags: ["hive"],
      neverVoteAuthors: [],
      curationWindowToleranceSeconds: 150,
    },
    now,
    fixtures: {
      dynamicGlobalProperties: Object.fromEntries(nodes.map((node) => [node, { head_block_number: 100000 }])),
      accounts: Object.fromEntries(nodes.map((node) => [`${node}|michael561`, account])),
      rankedPosts: Object.fromEntries(nodes.map((node) => [`${node}|hive`, [post]])),
      curationPrice: { hbdPerRshare: { num: 1n, den: 10_000_000n }, percentCurationRewards: 5000, votePowerReserveRate: 10 },
      config: { HIVE_REVERSE_AUCTION_WINDOW_SECONDS_HF25: 0 },
    },
    fetchImpl: async () => assert.fail("there must be no read of the held account"),
    sign: async ({ account: voter }) => {
      submitted.push(voter);
      return { status: "broadcast", id: "a".repeat(40) };
    },
    confirm: async () => nodes.map((node) => ({ node })),
  });
  assert.deepEqual(Object.keys(result.yieldReadout.accounts), ["michael561"]);
  assert.deepEqual(Object.keys(result.accounts), ["michael561"]);
  assert.deepEqual(submitted, ["michael561"], JSON.stringify(result.accounts.michael561.schedule));
  assert.equal(result.accounts.michael561.schedule.manaBudgetPercent, 20);
  assert.equal(result.accounts.michael561.cast.cast.length, 1);
});
