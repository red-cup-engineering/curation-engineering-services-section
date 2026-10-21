#!/usr/bin/env node
/**
 * Is the Hive shadow curator ready for the Leader to consider live voting? A read-only check of its journal: it writes nothing, votes for nothing and
 * authorizes nothing. Exit status: 0 the readiness gate passes, 1 it does not, 2 the journal could not be read or holds no settled decision.
 *
 * The gate is the prediction engineering section's `assessClusteredEdge` over the settled decisions the curator selected: the one-sided lower
 * confidence bound of their reward per unit above the average candidate's must be positive, from enough independent posts that a record with no
 * misses would still bound the miss rate under the break-even one. A decision settles only after its post's 7 day payout window, so the first verdict
 * is possible about 8 days after the daemon starts.
 *
 *   node scripts/curation-readiness.mjs [--data <dir>] [--alpha 0.05] [--resamples 2000] [--json]
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { assessShadowCurator } from "../src/shadow-curator.mjs";

const { values } = parseArgs({ options: { data: { type: "string" }, alpha: { type: "string", default: "0.05" }, resamples: { type: "string", default: "2000" }, json: { type: "boolean", default: false } } });
const data = values.data ?? process.env.HIVE_SHADOW_CURATOR_DATA ?? join(process.env.HOME ?? homedir(), ".local", "state", "561-group", "hive-shadow-curator");
let rows, report;
try {
  const file = join(data, "journal.jsonl");
  if (!existsSync(file)) throw new Error(`no journal at ${file}`);
  rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  if (!rows.some((r) => r.kind === "settle")) throw new Error(`${rows.filter((r) => r.kind === "decision").length} decisions, none settled yet (a decision settles after its post's payout window)`);
  report = assessShadowCurator(rows, { alpha: Number(values.alpha), resamples: Number(values.resamples), seed: 7 });
} catch (error) {
  process.stderr.write(`curation-readiness: ${error.message}\n`);
  process.exit(2);
}
if (values.json) process.stdout.write(`${JSON.stringify(report, null, 1)}\n`);
else {
  process.stdout.write(`Hive shadow curator: ${report.pass ? "READY (the Leader decides)" : "NOT READY"}  ${report.settled} settled, ${report.selected} selected\n`);
  for (const [name, c] of Object.entries(report.checks)) process.stdout.write(`  ${c.pass ? "pass" : "FAIL"} ${name}: ${JSON.stringify(c.value)} (need ${c.need})\n`);
  process.stdout.write(`  Brier ${report.brier?.toFixed(3)}, per-unit edge ${report.perUnit?.toExponential(2)}, lower bound ${report.interval?.oneSidedLower?.toExponential(2)}\n`);
}
process.exitCode = report.pass ? 0 : 1;
