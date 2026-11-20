#!/usr/bin/env node
import { temporaryRoot } from "@red-cup-engineering/computer-file-engineering-services-section/temporary-directory";
/**
 * The Hive shadow curator as a long-running process for a host to run as a unit: it fits the reward predictor once from the measurements this
 * package ships, then every interval records which recent posts it would vote on, and once a day records what the votes of closed payout windows
 * would have earned. It reads public Hive nodes and nothing else: it holds no key, signs nothing, broadcasts nothing and imports no casting code.
 *
 *   node scripts/curation-shadow-daemon.mjs --data <dir> [--age 3600] [--fraction 0.5] [--own 1e10] [--interval 600] [--settle-limit 100] [--once]
 *
 * Environment: HIVE_SHADOW_CURATOR_DATA (default $HOME/.local/state/561-group/hive-shadow-curator). Judge it with scripts/curation-readiness.mjs.
 */
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { run } from "./shadow-curator-cycle.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const MEASUREMENT = "../data/records/2026-10-19-hive-curation-measurement";

export async function runDaemon({ data, age = 3600, fraction = 0.5, own = 1e10, interval = 600, settleEvery = 86400, settlementLimit = 100, signal, once = false, log = (l) => process.stderr.write(l), runImpl = run, clock = () => Date.now() } = {}) {
  if (!Number.isSafeInteger(settlementLimit) || settlementLimit < 1) {
    throw new RangeError("settle-limit must be a positive integer");
  }
  mkdirSync(data, { recursive: true });
  if (!existsSync(join(data, "predictor.json"))) {
    const fitted = await runImpl(["fit-predictor", "--data", data, "--paid", here(`${MEASUREMENT}/paid-curve.jsonl.gz`), "--universe", here(`${MEASUREMENT}/universe.jsonl.gz`), "--age", String(age), "--fraction", String(fraction), "--own", String(own)]);
    log(`[curation-shadow] predictor fitted from ${fitted.fitted} posts\n`);
  }
  let lastSettle = -Infinity, settlementOffset = 0;
  do {
    const started = clock();
    try { log(`[curation-shadow] observe ${JSON.stringify(await runImpl(["observe", "--data", data, "--slack", String(interval)]))}\n`); } catch (error) { log(`[curation-shadow] observe: ${error.message}\n`); }
    if (started - lastSettle >= settleEvery * 1000) {
      try {
        const result = await runImpl(["settle", "--data", data], { settlementLimit, settlementOffset });
        log(`[curation-shadow] settle ${JSON.stringify(result)}\n`);
        settlementOffset = result.nextOffset ?? 0;
        if (result.nextOffset == null) lastSettle = started;
      } catch (error) { log(`[curation-shadow] settle: ${error.message}\n`); }
    }
    if (once) return;
    try {
      await delay(Math.max(1000, interval * 1000 - (clock() - started)), undefined, { signal });
    } catch (error) {
      if (error.name !== "AbortError") throw error;
    }
  } while (!signal?.aborted);
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const { values } = parseArgs({ options: { data: { type: "string" }, age: { type: "string", default: "3600" }, fraction: { type: "string", default: "0.5" }, own: { type: "string", default: "1e10" }, interval: { type: "string", default: "600" }, "settle-limit": { type: "string", default: "100" }, once: { type: "boolean", default: false } } });
  const data = values.data ?? process.env.HIVE_SHADOW_CURATOR_DATA ?? join(temporaryRoot(fileURLToPath(new URL(".", import.meta.url))), "..", "hive-shadow-curator-state");
  const controller = new AbortController();
  for (const s of ["SIGTERM", "SIGINT"]) process.once(s, () => controller.abort());
  await runDaemon({ data, age: Number(values.age), fraction: Number(values.fraction), own: Number(values.own), interval: Number(values.interval), settlementLimit: Number(values["settle-limit"]), signal: controller.signal, once: values.once });
}
