import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { run } from "../scripts/shadow-curator-cycle.mjs";
import { readRpc } from "../src/hive-post-source.mjs";

const method = "condenser_api.get_content";
const now = () => new Date("2026-11-17T03:00:00Z");
const created = "2026-10-29T00:00:00";
const deleted = (author, permlink) => ({
  error: { code: -31999, data: `Post ${author}/${permlink} was deleted 1 time(s)`, message: "Invalid parameters" },
});
const paid = (author, permlink) => ({
  result: { author, permlink, created, last_payout: "2026-11-05T00:00:00", allow_curation_rewards: false },
});

test("settlement records confirmed deletions, defers RPC errors and reaches later decisions", async (t) => {
  const data = mkdtempSync(join(tmpdir(), "hive-shadow-settlement-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const journal = join(data, "journal.jsonl");
  writeFileSync(join(data, "predictor.json"), JSON.stringify({
    predictor: { ageSeconds: 3600, reference: 1, counterfactual: {} },
    curve: { bins: [{ from: 0, to: 86400, median: 1 }] },
  }));
  const authors = ["deleted-post", "retry-post", "paid-post"];
  writeFileSync(journal, authors.map((author) => JSON.stringify({ kind: "decision", author, permlink: "entry", created })).join("\n") + "\n");
  const fetchImpl = async (node, init) => {
    const request = JSON.parse(init.body);
    assert.equal(request.method, method);
    const [author, permlink] = request.params;
    if (author === "deleted-post" && node.includes("deathwing")) return new Response(null, { status: 403 });
    if (author === "deleted-post") return Response.json(deleted(author, permlink));
    if (author === "retry-post") return Response.json(deleted("different-post", permlink));
    return Response.json(paid(author, permlink));
  };

  const options = { fetchImpl, now, settlementLimit: 2 };
  const first = await run(["settle", "--data", data], options);
  assert.equal(first.unavailable, 1);
  assert.equal(first.failed, 1);
  assert.equal(first.nextOffset, 1);
  const second = await run(["settle", "--data", data], { ...options, settlementOffset: first.nextOffset });
  assert.equal(second.settled, 1);
  assert.equal(second.nextOffset, null);
  assert.deepEqual(readFileSync(journal, "utf8").trim().split("\n").map((line) => {
    const row = JSON.parse(line);
    return [row.kind, row.author];
  }), [
    ...authors.map((author) => ["decision", author]),
    ["unavailable", "deleted-post"],
    ["settle", "paid-post"],
  ]);
});

test("a matching post takes precedence over a deletion response from another node", async () => {
  const author = "hive-user", permlink = "entry";
  const nodes = ["https://first.example", "https://second.example"];
  const fetchImpl = async (node) => Response.json(node === nodes[0] ? deleted(author, permlink) : paid(author, permlink));
  assert.deepEqual(await readRpc({ nodes, method, params: [author, permlink], fetchImpl }), paid(author, permlink).result);
});
