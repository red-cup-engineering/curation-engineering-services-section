/**
 * Hive curation as an operation family, so the fleet's curation duty runs in the world: one
 * verb runs one cycle for every account whose strategy carries the curation lane, from the fleet
 * config's curation block, casting through the fleet signer (which judges each vote against the
 * house's rules).
 */
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { operation } from "@red-cup-engineering/computer-engine/rpc/operation";
import { curationPolicy } from "@red-cup-engineering/hive-fleet-operations-service/strategy";
import { runHiveCurationCycle } from "../scripts/run-hive-curation-cycle.mjs";

function receiveAccountPolicy(path, fleet) {
  if (typeof path !== "string" || !isAbsolute(path)) {
    throw new TypeError("Hive curation accountPolicyPath must be an absolute path");
  }
  const policy = JSON.parse(readFileSync(path, "utf8"));
  if (policy?.type !== "HiveCurationPolicyRecord" || ![policy.accounts, policy.heldAccounts].every(
    (accounts) => Array.isArray(accounts) && accounts.every((account) => typeof account === "string" && account.length > 0)
  )) {
    throw new TypeError("Hive curation requires the installed account allowlist and holds");
  }
  return {
    accounts: fleet.accounts.filter((account) => policy.accounts.includes(account)),
    heldAccounts: policy.heldAccounts,
  };
}

export function hiveCurationOperations(_binding, { configuration } = {}) {
  const accountPolicyPath = configuration?.accountPolicyPath;
  return Object.freeze([
    operation({
      verb: "hive-curation-cycle",
      summary: "Run one Hive curation cycle: observe tribe curation yield, schedule votes inside each account's mana budget, and cast them through the fleet signer.",
      reads: ["hive/chain", "hive-engine/tokens"],
      writes: ["hive/votes"],
      effects: { class: "external", replay: "coordinated", coordination: "coordination-required", deterministic: "unmeasured", totality: "unmeasured" },
      run: (input) => {
        const fleet = curationPolicy();
        const accountPolicy = accountPolicyPath === undefined ? {} : receiveAccountPolicy(accountPolicyPath, fleet);
        return runHiveCurationCycle({ policy: { ...fleet, ...accountPolicy, journalRoot: input?.journalRoot } });
      },
    }),
  ]);
}
