// Collects paid-out Hive posts from public API: final payout, every vote (time, rshares), and the curation rewards actually paid.
import { appendFileSync, writeFileSync, existsSync, readFileSync } from "node:fs";
const URL_ = process.env.HIVE_API ?? "https://api.hive.blog";
const rpc = async (method, params, tries = 4) => { for (let i = 0; i < tries; i++) { try { const r = await fetch(URL_, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(30000) }); const j = await r.json(); if (j.result !== undefined) return j.result; } catch {} await new Promise((r) => setTimeout(r, 500 * (i + 1))); } return null; };
const [from, to, out] = [+process.argv[2], +process.argv[3], process.argv[4]];
const val = (a) => (a ? Number(a.amount) / 10 ** a.precision : 0);
const blocks = Array.from({ length: to - from }, (_, i) => from + i);
let next = 0, posts = 0;
async function worker() {
  while (next < blocks.length) {
    const b = blocks[next++];
    const r = await rpc("account_history_api.get_ops_in_block", { block_num: b, only_virtual: true });
    if (!r) continue;
    const cms = r.ops.filter((o) => o.op.type === "comment_reward_operation").map((o) => o.op.value);
    for (const cm of cms) {
      const cr = r.ops.filter((o) => o.op.type === "curation_reward_operation" && o.op.value.author === cm.author && o.op.value.permlink === cm.permlink).map((o) => ({ curator: o.op.value.curator, vests: Number(o.op.value.reward.amount) / 1e6 }));
      const [votes, content] = await Promise.all([rpc("condenser_api.get_active_votes", [cm.author, cm.permlink]), rpc("condenser_api.get_content", [cm.author, cm.permlink])]);
      if (!votes || !content) continue;
      appendFileSync(out, JSON.stringify({ block: b, author: cm.author, permlink: cm.permlink, created: content.created, cashout: content.last_payout, depth: content.depth, payout: val(cm.payout), authorHbd: val(cm.total_payout_value), curatorHbd: val(cm.curator_payout_value), beneficiaryHbd: val(cm.beneficiary_payout_value), authorRewardsHP: cm.author_rewards, maxAccepted: content.max_accepted_payout, allowCuration: content.allow_curation_rewards, votes: votes.map((v) => ({ voter: v.voter, time: v.time, rshares: Number(v.rshares), percent: v.percent })), rewards: cr }) + "\n");
      posts++;
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
console.log("posts", posts);
