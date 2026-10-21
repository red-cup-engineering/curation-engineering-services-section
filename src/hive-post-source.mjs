/**
 * Reads public Hive API data into HivePostOutcomeRecords. Read-only: it calls get methods of public nodes and nothing that carries a key.
 */
const READ_ONLY = new Set(["condenser_api.get_discussions_by_created", "condenser_api.get_content"]);
const hbd = (s) => Number(String(s ?? "0").split(" ")[0]);

export async function readRpc({ nodes, method, params, fetchImpl = fetch }) {
  if (!READ_ONLY.has(method)) throw new TypeError(`hive-post-source reads only ${[...READ_ONLY].join(", ")}`);
  let last;
  for (const node of nodes) {
    try {
      const response = await fetchImpl(node, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(30000) });
      const json = await response.json();
      if (json.result !== undefined) return json.result;
      last = new Error(`${node}: ${JSON.stringify(json.error ?? json).slice(0, 120)}`);
    } catch (error) { last = error; }
  }
  throw last ?? new Error("no nodes");
}

/**
 * Root posts created at or after `since` (epoch seconds), newest first. The API returns at most 20 per call, so the window is paged back from the newest by
 * the last post seen; a page that ends before `since` or a repeat of the last page stops the walk.
 */
export async function readRootPostsSince({ nodes, since, fetchImpl = fetch, maxPages = 30 }) {
  const out = [], seen = new Set();
  let start = {};
  for (let page = 0; page < maxPages; page += 1) {
    const rows = await readRpc({ nodes, method: "condenser_api.get_discussions_by_created", params: [{ tag: "", limit: 20, ...start }], fetchImpl });
    const fresh = rows.filter((r) => !seen.has(`${r.author}/${r.permlink}`));
    if (fresh.length === 0) break;
    for (const r of fresh) { seen.add(`${r.author}/${r.permlink}`); out.push(r); }
    const last = rows.at(-1);
    if (Date.parse(`${last.created}Z`) / 1000 < since) break;
    start = { start_author: last.author, start_permlink: last.permlink };
  }
  return out.filter((r) => Date.parse(`${r.created}Z`) / 1000 >= since);
}

/** A condenser discussion or content object as a HivePostOutcomeRecord. */
export function outcomeRecord(c) {
  let tags = []; try { tags = JSON.parse(c.json_metadata || "{}").tags ?? []; } catch {}
  return {
    author: c.author, permlink: c.permlink, created: c.created, category: c.category, tags, lastPayout: c.last_payout, paid: !String(c.last_payout).startsWith("1970"),
    totalPayout: hbd(c.total_payout_value), curatorPayout: hbd(c.curator_payout_value), pendingPayout: hbd(c.pending_payout_value), maxAccepted: hbd(c.max_accepted_payout),
    allowCuration: c.allow_curation_rewards, percentHbd: c.percent_hbd, beneficiaries: c.beneficiaries ?? [], authorReputation: Number(c.author_reputation), bodyLength: (c.body ?? "").length,
    netRshares: Number(c.net_rshares), votes: (c.active_votes ?? []).map((v) => ({ voter: v.voter, time: v.time, rshares: Number(v.rshares), percent: v.percent })),
  };
}
