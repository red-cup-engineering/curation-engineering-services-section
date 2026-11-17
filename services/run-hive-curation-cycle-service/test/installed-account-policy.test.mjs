import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("the installed schedule applies its configured account policy before calling the cycle", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "hive-scheduled-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const accountPolicyPath = join(root, "policy.json");
  const cycle = new URL("../scripts/run-hive-curation-cycle.mjs", import.meta.url).href;
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (url !== cycle) return nextLoad(url, context);
      return {
        format: "module",
        source: "export async function runHiveCurationCycle({ policy }) { return policy; }",
        shortCircuit: true,
      };
    },
  });
  let hiveCurationOperations;
  try {
    ({ hiveCurationOperations } = await import("../src/operations.mjs"));
  } finally {
    hooks.deregister();
  }
  const [operation] = hiveCurationOperations(undefined, { configuration: { accountPolicyPath } });
  await assert.rejects(Promise.resolve().then(() => operation.execute({ journalRoot: root }, [], {})), /ENOENT/);
  writeFileSync(accountPolicyPath, JSON.stringify({
    type: "HiveCurationPolicyRecord",
    accounts: ["michael561"],
    heldAccounts: ["emsenn0"],
  }));
  const input = await operation.execute({ journalRoot: root }, [], {});
  assert.deepEqual(input.accounts, ["michael561"]);
  assert.deepEqual(input.heldAccounts, ["emsenn0"]);
  assert.equal(input.journalRoot, root);
  assert.equal(input.maxDailyBudgetPercent, 20);
  assert.equal(input.maxWeight, 3000);
});
