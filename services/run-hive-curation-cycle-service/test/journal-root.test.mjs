import test from "node:test";
import assert from "node:assert/strict";
import { runHiveCurationCycle } from "../scripts/run-hive-curation-cycle.mjs";
import { hiveCurationOperations } from "../src/operations.mjs";

test("a cycle without a caller-supplied policy is refused instead of reading packaged config", async () => {
  await assert.rejects(runHiveCurationCycle({}), /request\.policy is required/u);
});

test("a policy without the host's absolute journal directory is refused", async () => {
  const policy = { accounts: [], tags: [], nodes: [] };
  await assert.rejects(runHiveCurationCycle({ policy }), /journalRoot must be the host's absolute journal directory/u);
  await assert.rejects(runHiveCurationCycle({ policy: { ...policy, journalRoot: "relative/journal" } }), /absolute/u);
});

test("the job verb takes the journal directory from the job input, not from the fleet config", async () => {
  const [verb] = hiveCurationOperations();
  assert.equal(verb.verb, "hive-curation-cycle");
  await assert.rejects(Promise.resolve().then(() => verb.execute({}, [], {})), /journalRoot must be the host's absolute journal directory/u);
});
