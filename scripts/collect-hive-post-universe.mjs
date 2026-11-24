// Collects an unbiased universe of root posts: every sampled new root post in a block window with its FINAL outcome (paid or not), all votes and rewards fields.
import { appendFileSync } from "node:fs";
const NODES = ["https://api.hive.blog", "https://api.deathwing.me", "https://api.openhive.network"];
let rot = 0;
const rpc = async (method, params, tries = 6) => { for (let i = 0; i < tries; i++) { const node = NODES[(rot++) % NODES.length]; try { const r = await fetch(node, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(30000) }); const j = await r.json(); if (j.result !== undefined) return j.result; } catch {} await new Promise((r) => setTimeout(r, 400 * (i + 1))); } return null; };
const [from, to, out, every = 1] = [+process.argv[2], +process.argv[3], process.argv[4], +(process.argv[5] ?? 1)];
const val = (s) => Number(String(s).split(" ")[0]);
let next = from, posts = 0, seen = 0;
async function worker() {
  while (next < to) {
    const b = next++;
    const r = await rpc("account_history_api.get_ops_in_block", { block_num: b, only_virtual: false });
    if (!r) continue;
    for (const o of r.ops) {
      if (o.op.type !== "comment_operation" || o.op.value.parent_author !== "") continue;
      if ((seen++ % every) !== 0) continue;
      const c = await rpc("condenser_api.get_content", [o.op.value.author, o.op.value.permlink]);
      if (!c || !c.created) continue;
      if (Math.abs(Date.parse(c.created + "Z") - Date.parse(o.timestamp + "Z")) > 4000) continue; // an edit, not the creation
      let meta = {}; try { meta = JSON.parse(c.json_metadata || "{}"); } catch {}
      appendFileSync(out, JSON.stringify({ block: b, author: c.author, permlink: c.permlink, created: c.created, category: c.category, tags: meta.tags ?? [], lastPayout: c.last_payout, cashout: c.cashout_time, paid: !c.last_payout.startsWith("1970"), totalPayout: val(c.total_payout_value), curatorPayout: val(c.curator_payout_value), pendingPayout: val(c.pending_payout_value), maxAccepted: val(c.max_accepted_payout), allowCuration: c.allow_curation_rewards, percentHbd: c.percent_hbd, beneficiaries: c.beneficiaries, authorReputation: c.author_reputation, bodyLength: c.body.length, netRshares: Number(c.net_rshares), votes: c.active_votes.map((v) => ({ voter: v.voter, time: v.time, rshares: Number(v.rshares), percent: v.percent })) }) + "\n");
      posts++;
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log("posts", posts, "seen", seen);
