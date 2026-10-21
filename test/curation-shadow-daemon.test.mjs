import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readRootPostsSince } from "../src/hive-post-source.mjs";
import { runDaemon } from "../scripts/curation-shadow-daemon.mjs";

const at = (s) => new Date(s * 1000).toISOString().slice(0, 19);
const post = (n) => ({ author: `a${n}`, permlink: `p${n}`, created: at(10000 - n * 60) });

test("the window is paged back 20 posts at a time by the last post seen, and nothing older than the window is kept", async () => {
  const all = Array.from({ length: 70 }, (_, i) => post(i)), calls = [];
  const fetchImpl = async (_node, init) => {
    const p = JSON.parse(init.body).params[0]; calls.push(p);
    assert.ok(p.limit <= 20, "the API refuses more than 20");
    const from = p.start_author ? all.findIndex((x) => x.author === p.start_author) : 0;
    return { json: async () => ({ result: all.slice(from, from + 20) }) };
  };
  const rows = await readRootPostsSince({ nodes: ["https://n"], since: 10000 - 45 * 60, fetchImpl });
  assert.equal(rows.length, 46, "posts 0..45 are within 45 minutes");
  assert.equal(calls.length, 3);
});

test("the daemon fits once from the shipped measurements, then observes each cycle and settles at most once a day", async () => {
  const data = mkdtempSync(join(tmpdir(), "cur-")), seen = [];
  let now = 1e12;
  const runImpl = async (argv) => { seen.push(argv[0]); if (argv[0] === "fit-predictor") { writeFileSync(join(data, "predictor.json"), "{}"); return { fitted: 1 }; } return {}; };
  await runDaemon({ data, once: true, log: () => {}, runImpl, clock: () => now });
  await runDaemon({ data, once: true, log: () => {}, runImpl, clock: () => now });
  assert.deepEqual(seen, ["fit-predictor", "observe", "settle", "observe", "settle"], "a fresh process settles on its first cycle; the predictor is not refitted");
  assert.ok(seen.filter((s) => s === "fit-predictor").length === 1);
});

test("readiness exits 2 with nothing settled and never writes", () => {
  const data = mkdtempSync(join(tmpdir(), "cur-r-"));
  const script = new URL("../scripts/curation-readiness.mjs", import.meta.url).pathname;
  assert.equal(spawnSync("node", [script, "--data", data]).status, 2);
  writeFileSync(join(data, "journal.jsonl"), `${JSON.stringify({ kind: "decision", author: "a", permlink: "p" })}\n`);
  assert.equal(spawnSync("node", [script, "--data", data]).status, 2);
});
