# schedule-set-of-votes
## Requirements
- `pure-transformation`: The operation performs no I/O (no network call, no file read, no clock beyond the injectable `request.now`); every input it needs (the yield readout, the account's mana, the vote policy, the chain's curation window, the candidate posts, the optional chain price) arrives as plain data.
- `requires-the-chain-curation-window`: The operation requires `request.curationWindowSeconds`, a finite non-negative number of seconds that the caller reads from the chain's reverse auction window (claim {{curation-window-seconds}}); it holds no default and no literal for it, and a request without it throws `TypeError`. [claims: curation-window-seconds]
- `reads-account-mana-from-readout`: The operation reads `request.yieldReadout.accounts[request.account].votingManabar` (`maxManaRaw`, `currentManaRaw`, both raw integer strings) as the account's voting mana; it refuses (throws `TypeError`) when `request.account` is not a key of `request.yieldReadout.accounts`.
- `applies-vote-policy`: The operation applies `request.policy` (defaults documented in its JSDoc and held in `DEFAULT_POLICY`): `dailyManaBudgetPercent` (percent of the account's current mana spendable today, handed to the selection as basis points), `minWeight`/`maxWeight` (Hive vote-weight bounds, out of {{max-vote-weight}}), a dust rule (`dustPendingPayoutThresholdHbd`, `dustWeight`) for low-payout posts per `task:dust-curation-micro-blogging`, `preferredTags` (tags whose posts get `maxWeight` instead of `minWeight` when not dust), `neverVoteAuthors`, and `curationWindowToleranceSeconds` (default {{curation-window-tolerance-seconds}}).
- `selects-through-the-one-curation-selection`: The operation converts each distinct candidate post (`request.candidatePosts` entries `{tag,symbol,post}`, `post` a `bridge.get_ranked_posts` record) to a post observation at `request.now` with `toPostObservation`, and chooses the votes with `selectCurationVotes` from `@red-cup-engineering/hive-computing-service/computing/curation`, which prices each vote, refuses by rule, and allocates the mana budget; the operation holds none of that logic itself. [claims: curation-selection-has-one-owner]
- `lists-a-post-once`: A post listed under several tags is one candidate, under the first tag that listed it, because the chain refuses a second identical vote on the same post.
- `prices-each-tag-at-its-observed-rate`: The operation prices a post at its tag's `yieldHbdPerMillionRshares` from the yield readout divided by a million as an exact rational; for a tag with no observed rate it prices at `request.price.hbdPerRshare` (`{num,den}`, with `percentCurationRewards` and `votePowerReserveRate`), and when `request.price` is absent a post whose tag has no observed rate is refused as `unpriced`.
- `schedules-within-window`: A post is excluded as `outside-window` unless its age in seconds falls inside `request.curationWindowSeconds` plus or minus `curationWindowToleranceSeconds`; each chosen vote is scheduled at `request.now` plus however many seconds remain until `curationWindowSeconds` has elapsed since the post's creation (zero if already past it), stated both as an ISO `time` and as an iCalendar basic UTC `dtstart` (standard `rfc-5545-vevent-dtstart`).
- `estimates-curation-return`: The operation reports `expectedCurationReturnHbd` per scheduled vote as the selection's expected curation reward for that vote, a decimal string truncated toward zero at {{return-decimal-places}} decimal places; it is the pricing of `selectCurationVotes`, never a formula of this operation.
- `reports-refusals`: The operation reports every refused candidate as `{tag,author,permlink,reason}` with exactly the one reason the selection gave: `author-excluded`, `already-voted`, `outside-window`, `unpriced`, `no-expected-curation-reward`, `not-admitted`, or `over-budget`; the post itself stays in the readout it was read from.
- `exact-decimal-strings`: Every numeric quantity in the returned record is a decimal string or a plain integer, derived with `@red-cup-engineering/computer-data-engineering-services-section`'s exact-number primitives (`rationalOfBigInts`, `rationalParts`, `parseDecimalAmount`, `rationalUnits`, `formatUnits`) — never a JavaScript float carried into a reported decimal. [claims: decimal-arithmetic-has-one-owner]
- `runs-as-a-node-operation`: The operation is a JSNode operation run through `runJavascriptNodeOperation` from `@red-cup-engineering/javascript-node-operation-service`: it reads one JSON request per standard-input line and writes one JSON record per output line, with the exported function behind the same record.
## Prohibitions
- `no-second-curation-selection`: The operation must not reimplement the mana cost, curation reward, trait valuation or mana allocation that `selectCurationVotes` owns; it only prepares that function's input and shapes its output. [claims: curation-selection-has-one-owner, dep-hive-computing-service]
- `no-second-decimal-arithmetic`: The operation must not re-implement decimal-string parsing, formatting or rational arithmetic that `@red-cup-engineering/computer-data-engineering-services-section` already exports. [claims: decimal-arithmetic-has-one-owner, dep-computer-data-engineering-services-section]
- `no-window-literal`: The operation must hold no literal for the curation window, neither as a default nor as a fallback; a caller that does not state it is refused. [claims: curation-window-seconds]
- `no-network-or-clock`: The operation must never call `fetch`, read a file, or read the clock for anything other than `request.now` being absent; every timestamp used in scheduling logic comes from `request.now`. [claims: a-pure-operation-does-no-io]
- `no-signing-or-broadcast`: The operation must never sign, broadcast, or accept a private key; it produces a schedule for `cast-set-of-votes` to execute, never executes anything itself. [claims: a-pure-operation-does-no-io]
## Laws
- `primitives-exist-once` | 561 Group working discipline | 2026-08-30 | CLAUDE.md | Applies to all exact-number arithmetic and to the curation selection in this operation. | The exact-number primitives live once, in `@red-cup-engineering/computer-data-engineering-services-section`, and the curation selection lives once, in `@red-cup-engineering/hive-computing-service`; this operation composes them by exact pin.
- `fabricate-do-not-hand-write` | 561 Group working discipline, dispatch-agents skill | 2026-09-04 | .claude/skills/dispatch-agents/SKILL.md | Applies to this whole operation source file. | The operation is born through the jsnode fabrication line from this work order, never hand-written; the fence below is the source the service repository holds.
- `voting-is-not-fenced` | Operating constraint | 2026-09-04 | .claude/rules/working-discipline.md | Applies to why this operation and its siblings exist at all. | The standing fence is no automated POSTING or commenting from the existing Hive accounts; voting was never fenced, so scheduling and casting votes are in scope.
## Standards
- `node-esm-operation` | Node.js | v24.2.0+ | https://nodejs.org/docs/v24/api/esm.html | Applies to the .mjs operation and its import.meta.main guard. | The package uses one executable ESM operation source file eligible for downstream staged package-birth assays.
- `rfc-5545-vevent-dtstart` | IETF RFC 5545 iCalendar | 2009 | https://www.rfc-editor.org/rfc/rfc5545#section-3.8.2.4 | Applies to the `dtstart` stated on each scheduled vote. | A VEVENT with no RRULE occurs once at DTSTART, stated as a basic UTC date-time `YYYYMMDDTHHMMSSZ`.
## Open questions
- `unused-direct-dependencies` [nonblocking]: The package pins `@red-cup-engineering/metrologic` and `@red-cup-engineering/exact-number-data-service` although the operation source imports neither directly (the selection it composes does); a follow-on version may drop them or the operation may import them.
## Claims
- `dep-hive-computing-service` | measured | dependency | @red-cup-engineering/hive-computing-service@0.0.1 is published on the Group registry | none | data/records/2026-10-19-work-order-evidence/npm-view-red-cup-engineering-hive-computing-service-0-0-1.json | sha256:da36638f0fd40133690cbda08cad1497382d01fbd59f42723e47f2efe9853a14 | npm view of @red-cup-engineering/hive-computing-service@0.0.1 returned its name, version and integrity (2026-10-21)
- `dep-metrologic` | measured | dependency | @red-cup-engineering/metrologic@0.4.0 is published on the Group registry | none | data/records/2026-10-19-work-order-evidence/npm-view-red-cup-engineering-metrologic-0-4-0.json | sha256:99e8a4602ca9f573ddd2580651eed73b8833323b1f7e14eca5d564df3b032983 | npm view of @red-cup-engineering/metrologic@0.4.0 returned its name, version and integrity (2026-10-21)
- `dep-computer-data-engineering-services-section` | measured | dependency | @red-cup-engineering/computer-data-engineering-services-section@0.2.0 is published on the Group registry | none | data/records/2026-10-19-work-order-evidence/npm-view-red-cup-engineering-computer-data-engineering-services-section-0-2-0.json | sha256:3cec3d1307e5a66272e88de7be53928fb37ffbc70da96f7cbfeb56cc0fdd0b40 | npm view of @red-cup-engineering/computer-data-engineering-services-section@0.2.0 returned its name, version and integrity (2026-10-21)
- `dep-exact-number-data-service` | measured | dependency | @red-cup-engineering/exact-number-data-service@0.1.1 is published on the Group registry | none | data/records/2026-10-19-work-order-evidence/npm-view-red-cup-engineering-exact-number-data-service-0-1-1.json | sha256:fee8f3290c3ed9c0511b58fa0ffac4dbcb2d47748dab46cbd9ae6594362ad98f | npm view of @red-cup-engineering/exact-number-data-service@0.1.1 returned its name, version and integrity (2026-10-21)
- `dep-javascript-node-operation-service` | measured | dependency | @red-cup-engineering/javascript-node-operation-service@0.1.0 is published on the Group registry | none | data/records/2026-10-19-work-order-evidence/npm-view-red-cup-engineering-javascript-node-operation-service-0-1-0.json | sha256:7ec276741c166ec7f8341385694adefb52cd156e08bc8fe8f8347b6dca1d3f8d | npm view of @red-cup-engineering/javascript-node-operation-service@0.1.0 returned its name, version and integrity (2026-10-21)
- `max-vote-weight` | measured | parameter | The chain's full vote weight, HIVE_100_PERCENT, in weight units | 10000 weight-units | data/records/2026-10-19-work-order-evidence/hive-get-config.json | sha256:9d2d3f0b604321d5f29dfcd84386303a13c2e78ee89d7dc01664bfcd81bcd9b8 | condenser_api.get_config returned HIVE_100_PERCENT 10000 (2026-10-19)
- `reverse-auction-window-hf25` | measured | parameter | From hardfork 25 the chain's reverse auction window, HIVE_REVERSE_AUCTION_WINDOW_SECONDS_HF25, is zero (it was 300 seconds at hardfork 21) | 0 s | data/records/2026-10-19-work-order-evidence/hive-get-config.json | sha256:9d2d3f0b604321d5f29dfcd84386303a13c2e78ee89d7dc01664bfcd81bcd9b8 | condenser_api.get_config returned HIVE_REVERSE_AUCTION_WINDOW_SECONDS_HF25 0 and _HF21 300 (2026-10-19)
- `curation-window-seconds` | derived | parameter | The age window inside which a vote's curation reward share can differ is the chain's reverse auction window, which is zero from hardfork 25, so a vote earns the full share from the post's creation | 0 s | claim:reverse-auction-window-hf25 | The window is the chain constant HIVE_REVERSE_AUCTION_WINDOW_SECONDS_HF25, measured as 0 s on 2026-10-19; no literal stands in for it
- `curation-window-tolerance-seconds` | conjectured | parameter | A schedule may land this many seconds either side of the window | 60 s | The scheduler's timing error is small against the window | Seconds between a scheduled vote time and the block that carries it | The vote journal of cast-set-of-votes | Set the tolerance to the 99th percentile of that lag | The order's present value, taken as the best estimate
- `return-decimal-places` | conjectured | parameter | The reported expected curation return keeps this many decimal places, finer than the chain's three-place HBD amounts | 12 decimal-places | Truncating the expected return at this many places loses less than a thousandth of the smallest HBD amount | The difference between the reported expectedCurationReturnHbd and the exact rational the selection computed for the same vote | The shadow curator's schedule records beside a recomputation of the selection at higher precision | Raise the places if any difference reaches a millionth of the smallest HBD amount | The source's present value, taken as the best estimate
- `curation-selection-has-one-owner` | derived | world | The curation selection (mana cost, expected curation reward, valuation and allocation) has one owner, published at the exact version this order pins | none | constraint:primitives-exist-once; claim:dep-hive-computing-service | The law places the selection once in its owner, and the pinned owner is on the registry, so composing it leaves nothing to reimplement
- `decimal-arithmetic-has-one-owner` | derived | world | Decimal-string parsing, formatting and rational arithmetic have one owner, published at the exact version this order pins | none | constraint:primitives-exist-once; claim:dep-computer-data-engineering-services-section | The law places the primitive once in its owner, and the pinned owner is on the registry, so composing it leaves nothing to reimplement and a second implementation is outside what the law permits
- `a-pure-operation-does-no-io` | derived | world | An operation that performs no I/O has no network call, file read or clock of its own to broadcast with | none | requirement:pure-transformation | The requirement admits no I/O beyond the injectable now, and signing or broadcasting is I/O
## Package
```json
{"packageName":"@red-cup-engineering/schedule-set-of-votes-service","packageVersion":"0.3.0","license":"UNLICENSED","dependencies":{"@red-cup-engineering/hive-computing-service":"0.0.1","@red-cup-engineering/metrologic":"0.4.0","@red-cup-engineering/computer-data-engineering-services-section":"0.2.0","@red-cup-engineering/exact-number-data-service":"0.1.1","@red-cup-engineering/javascript-node-operation-service":"0.1.0"},"devDependencies":{}}
```
## Operation
```mjs path=scripts/schedule-set-of-votes.mjs
#!/usr/bin/env node
import { rationalOfBigInts, rationalParts } from "@red-cup-engineering/computer-data-engineering-services-section/number/exact-number";
import { formatUnits, rationalUnits } from "@red-cup-engineering/computer-data-engineering-services-section/number/decimal-string";
import { gradedValue, parseDecimalAmount } from "@red-cup-engineering/computer-data-engineering-services-section/number/graded";
import { selectCurationVotes, toPostObservation } from "@red-cup-engineering/hive-computing-service/computing/curation";
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-operation-service";

const DEFAULT_POLICY = Object.freeze({
  dailyManaBudgetPercent: 20,
  minWeight: 100,
  maxWeight: 10000,
  dustPendingPayoutThresholdHbd: "0.02",
  dustWeight: 100,
  preferredTags: Object.freeze([]),
  neverVoteAuthors: Object.freeze([]),
  curationWindowToleranceSeconds: 60,
});

/**
 * Formats a Date as an RFC 5545 basic UTC date-time ("YYYYMMDDTHHMMSSZ"), the DTSTART form expand-recurrence-rule-service requires.
 * @param {Date} date
 * @returns {string}
 */
function toBasicUtcDateTime(date) {
  return date.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

/**
 * Schedules a day's Hive curation votes for one account: the one curation selection
 * (@red-cup-engineering/hive-computing-service's selectCurationVotes) over the candidates' post observations,
 * each priced at its tag's observed HBD per rshare (else the chain's `request.price`), weighted by
 * policy (preferred tags at maxWeight, dust at dustWeight, else minWeight), refused outside the
 * curation window, and budgeted at dailyManaBudgetPercent of current mana; each chosen vote is
 * scheduled for when its post reaches the window.
 * @param {object} request
 * @param {object} request.yieldReadout A TribeCurationYieldObservationRecord naming this account's votingManabar and each tag's yieldHbdPerMillionRshares.
 * @param {string} request.account The account to schedule votes for; must be a key of request.yieldReadout.accounts.
 * @param {number} request.curationWindowSeconds Required. The chain's reverse auction window in seconds (HIVE_REVERSE_AUCTION_WINDOW_SECONDS_HF25), read by the caller; the operation holds no literal for it.
 * @param {readonly object[]} request.candidatePosts Posts to consider: {tag, symbol, post}, post a bridge.get_ranked_posts record.
 * @param {object} [request.price] The chain's curation price (hbdPerRshare, percentCurationRewards, votePowerReserveRate), for tags with no observed price.
 * @param {object} [request.policy] Vote policy; see DEFAULT_POLICY for every field and its default.
 * @param {string} [request.now] An injectable ISO instant for generatedAt and vote time scheduling (default the real current time).
 * @returns {object} A VoteScheduleRecord: {type,version,account,generatedAt,manaBudgetRaw,manaBudgetPercent,scheduled,refused}.
 * @throws {TypeError} When request.account is not a key of request.yieldReadout.accounts.
 */
export function scheduleSetOfVotes(request) {
  const { yieldReadout, account, candidatePosts } = request;
  const accountMana = yieldReadout?.accounts?.[account]?.votingManabar;
  if (!accountMana) throw new TypeError(`schedule-set-of-votes: request.account ${account} is not a key of request.yieldReadout.accounts`);
  const policy = { ...DEFAULT_POLICY, ...(request.policy ?? {}) };
  const curationWindowSeconds = request.curationWindowSeconds;
  if (!Number.isFinite(curationWindowSeconds) || curationWindowSeconds < 0) throw new TypeError("schedule-set-of-votes: request.curationWindowSeconds is required, the chain's reverse auction window in seconds");
  const nowMs = request.now ? new Date(request.now).getTime() : Date.now();
  const currentManaRaw = BigInt(accountMana.currentManaRaw);
  const manaBudgetRaw = (currentManaRaw * BigInt(policy.dailyManaBudgetPercent)) / 100n;
  // Each tag's price per rshare as its recent posts realize it (pending payout per million net rshares).
  const tagPrice = new Map((yieldReadout.tags ?? []).map((tag) => {
    const perMillion = tag.yieldHbdPerMillionRshares == null ? null : parseDecimalAmount(String(tag.yieldHbdPerMillionRshares));
    return [tag.tag, perMillion ? rationalOfBigInts(rationalParts(perMillion.value)[0], rationalParts(perMillion.value)[1] * 1_000_000n) : null];
  }));
  const key = (observation) => `${observation.author}/${observation.permlink}`;
  // A post listed under several tags is one candidate, under the first tag that listed it: the
  // chain refuses a second identical vote on the same post.
  const candidates = [];
  for (const entry of candidatePosts) {
    const observation = toPostObservation(entry.post, nowMs);
    if (!candidates.some((kept) => key(kept.observation) === key(observation))) candidates.push({ ...entry, observation });
  }
  const tagOf = new Map(candidates.map((entry) => [key(entry.observation), entry.tag]));
  const lower = curationWindowSeconds - policy.curationWindowToleranceSeconds;
  const upper = curationWindowSeconds + policy.curationWindowToleranceSeconds;
  const [dustNum, dustDen] = rationalParts(parseDecimalAmount(policy.dustPendingPayoutThresholdHbd).value);
  const isDust = (observation) => observation.pendingPayoutHbdMicro * dustDen < dustNum * 1_000_000n;
  const priceOf = (observation) => tagPrice.get(tagOf.get(key(observation))) ?? null;
  const unpriced = request.price === undefined;
  const price = unpriced ? { hbdPerRshare: rationalOfBigInts(0n, 1n) } : {
    ...request.price,
    hbdPerRshare: rationalOfBigInts(BigInt(request.price.hbdPerRshare.num), BigInt(request.price.hbdPerRshare.den)),
  };
  const selection = selectCurationVotes({
    account,
    observations: candidates.map((entry) => entry.observation),
    mana: { currentMana: currentManaRaw, maxMana: BigInt(accountMana.maxManaRaw) },
    price,
    priceOf,
    policy: {
      budgetBps: policy.dailyManaBudgetPercent * 100,
      neverVoteAuthors: policy.neverVoteAuthors,
      weightOf: (observation) => isDust(observation) ? policy.dustWeight
        : policy.preferredTags.includes(tagOf.get(key(observation))) ? policy.maxWeight : policy.minWeight,
      exclude: (observation) => observation.ageSeconds < lower || observation.ageSeconds > upper ? "outside-window"
        : unpriced && priceOf(observation) === null ? "unpriced" : null,
    },
  });
  const scheduled = selection.votes.map((proposal) => {
    const observation = candidates.find((entry) => key(entry.observation) === proposal.id).observation;
    const scheduledDate = new Date(nowMs + Math.max(0, curationWindowSeconds - observation.ageSeconds) * 1000);
    // A vote's scheduled moment is a VEVENT with no RRULE: it occurs exactly once, at DTSTART (RFC 5545 §3.8.5.2).
    return {
      tag: tagOf.get(proposal.id), author: proposal.action.author, permlink: proposal.action.permlink, weight: proposal.action.weightBps,
      dtstart: toBasicUtcDateTime(scheduledDate), time: scheduledDate.toISOString(),
      expectedCurationReturnHbd: formatUnits(rationalUnits(gradedValue(proposal.expectedHbd), 12, { rounding: "toward-zero" }), 12),
    };
  });
  // A refusal names the post it refused; the post itself stays in the readout it was read from.
  const refused = selection.decisions.filter((decision) => !decision.accepted).map((decision) => {
    const { tag, post } = candidates.find((entry) => key(entry.observation) === decision.proposal.id);
    return { tag, author: post.author, permlink: post.permlink, reason: decision.reason };
  });
  return {
    type: "VoteScheduleRecord",
    version: 1,
    account,
    generatedAt: new Date(nowMs).toISOString(),
    manaBudgetRaw: manaBudgetRaw.toString(),
    manaBudgetPercent: policy.dailyManaBudgetPercent,
    scheduled,
    refused,
  };
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "schedule-set-of-votes", description: "Schedules a day's Hive curation votes for one account through the one curation selection, priced at each tag's observed rate.", operation: scheduleSetOfVotes }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
```
## Tests
```mjs path=test/schedule-set-of-votes.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { scheduleSetOfVotes } from "../scripts/schedule-set-of-votes.mjs";

const NOW = "2026-09-05T00:10:00.000Z";
const YIELD_READOUT = {
  tags: [{ tag: "proofofbrain", yieldHbdPerMillionRshares: "0.1" }],
  accounts: { emsenn0: { votingManabar: { maxManaRaw: "1000000000000", currentManaRaw: "1000000000000" } } },
};

// A bridge.get_ranked_posts record five minutes old: discussed, broadly voted, in a community.
function post(overrides = {}, entry = {}) {
  return { tag: "proofofbrain", symbol: "POB", post: { ...{
    author: "alice", permlink: "p1", category: "hive-167922", created: "2026-09-05T00:10:00",
    net_rshares: "5000000", abs_rshares: "5000000", pending_payout_value: "0.500 HBD", children: 3,
    author_reputation: "100000000000", json_metadata: "{}",
    active_votes: ["v1", "v2", "v3", "v4", "v5"].map((voter) => ({ voter, rshares: "1000000" })),
  }, ...overrides }, ...entry };
}

test("schedules a preferred-tag post at max weight inside the window and budget", () => {
  const record = scheduleSetOfVotes({
    curationWindowSeconds: 0,
    yieldReadout: YIELD_READOUT,
    account: "emsenn0",
    candidatePosts: [post({})],
    policy: { preferredTags: ["proofofbrain"] },
    now: NOW,
  });
  assert.equal(record.scheduled.length, 1);
  assert.equal(record.scheduled[0].weight, 10000);
  assert.equal(record.scheduled[0].author, "alice");
  assert.equal(record.refused.length, 0);
  assert.ok(Number(record.scheduled[0].expectedCurationReturnHbd) > 0);
});

test("applies the dust weight to a low-payout post regardless of tag preference", () => {
  const record = scheduleSetOfVotes({
    curationWindowSeconds: 0,
    yieldReadout: YIELD_READOUT,
    account: "emsenn0",
    candidatePosts: [post({ pending_payout_value: "0.001 HBD" })],
    policy: { preferredTags: ["proofofbrain"] },
    now: NOW,
  });
  assert.equal(record.scheduled[0].weight, 100);
});

test("refuses an excluded author", () => {
  const record = scheduleSetOfVotes({
    curationWindowSeconds: 0,
    yieldReadout: YIELD_READOUT,
    account: "emsenn0",
    candidatePosts: [post({ author: "spammer" })],
    policy: { neverVoteAuthors: ["spammer"] },
    now: NOW,
  });
  assert.deepEqual(record.refused[0].reason, "author-excluded");
});

test("refuses a request that does not carry the chain's curation window", () => {
  assert.throws(() => scheduleSetOfVotes({ yieldReadout: YIELD_READOUT, account: "emsenn0", candidatePosts: [post({})], now: NOW }), /curationWindowSeconds is required/);
});

test("refuses a post outside the curation window", () => {
  const record = scheduleSetOfVotes({
    curationWindowSeconds: 0,
    yieldReadout: YIELD_READOUT,
    account: "emsenn0",
    candidatePosts: [post({ created: "2026-09-05T00:05:00" })],
    now: NOW,
  });
  assert.equal(record.refused[0].reason, "outside-window");
});

test("refuses once the daily mana budget is spent", () => {
  const record = scheduleSetOfVotes({
    curationWindowSeconds: 0,
    yieldReadout: {
      tags: YIELD_READOUT.tags,
      accounts: { emsenn0: { votingManabar: { maxManaRaw: "1000000000000", currentManaRaw: "1000000000000" } } },
    },
    account: "emsenn0",
    candidatePosts: [post({ permlink: "p1" }), post({ permlink: "p2" }), post({ permlink: "p3" })],
    policy: { preferredTags: ["proofofbrain"], dailyManaBudgetPercent: 2 },
    now: NOW,
  });
  assert.equal(record.scheduled.length, 1);
  assert.equal(record.refused.length, 2);
  assert.equal(record.refused[0].reason, "over-budget");
});

test("refuses a post the account already voted", () => {
  const record = scheduleSetOfVotes({
    curationWindowSeconds: 0,
    yieldReadout: YIELD_READOUT,
    account: "emsenn0",
    candidatePosts: [post({ active_votes: ["emsenn0", "v2", "v3", "v4", "v5"].map((voter) => ({ voter, rshares: "1000000" })) })],
    now: NOW,
  });
  assert.equal(record.refused[0].reason, "already-voted");
});

test("refuses when the account is not a key of yieldReadout.accounts", () => {
  assert.throws(
    () => scheduleSetOfVotes({ curationWindowSeconds: 0, yieldReadout: YIELD_READOUT, account: "unknown561", candidatePosts: [], now: NOW }),
    /request\.account unknown561 is not a key/u,
  );
});
```
## Examples
```json name="schedules one preferred-tag post at max weight inside window and budget"
{"input":{"yieldReadout":{"tags":[{"tag":"proofofbrain","yieldHbdPerMillionRshares":"0.1"}],"accounts":{"emsenn0":{"votingManabar":{"maxManaRaw":"1000000000000","currentManaRaw":"1000000000000"}}}},"account":"emsenn0","curationWindowSeconds":0,"candidatePosts":[{"tag":"proofofbrain","symbol":"POB","post":{"author":"alice","permlink":"p1","category":"hive-167922","created":"2026-09-05T00:10:00","net_rshares":"5000000","abs_rshares":"5000000","pending_payout_value":"0.500 HBD","children":3,"author_reputation":"100000000000","json_metadata":"{}","active_votes":[{"voter":"v1","rshares":"1000000"},{"voter":"v2","rshares":"1000000"},{"voter":"v3","rshares":"1000000"},{"voter":"v4","rshares":"1000000"},{"voter":"v5","rshares":"1000000"}]}}],"policy":{"preferredTags":["proofofbrain"]},"now":"2026-09-05T00:10:00.000Z"},"output":{"type":"VoteScheduleRecord","version":1,"account":"emsenn0","generatedAt":"2026-09-05T00:10:00.000Z","manaBudgetRaw":"200000000000","manaBudgetPercent":20,"scheduled":[{"tag":"proofofbrain","author":"alice","permlink":"p1","weight":10000,"dtstart":"20260905T001000Z","time":"2026-09-05T00:10:00.000Z","expectedCurationReturnHbd":"997.500000000000"}],"refused":[]}}
```
## Traceability
- `pure-transformation` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `requires-the-chain-curation-window` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `reads-account-mana-from-readout` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `applies-vote-policy` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `voting-is-not-fenced`
- `selects-through-the-one-curation-selection` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `primitives-exist-once`
- `lists-a-post-once` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `voting-is-not-fenced`
- `prices-each-tag-at-its-observed-rate` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `primitives-exist-once`
- `schedules-within-window` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `rfc-5545-vevent-dtstart`
- `estimates-curation-return` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `primitives-exist-once`
- `reports-refusals` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `voting-is-not-fenced`
- `exact-decimal-strings` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `primitives-exist-once`
- `runs-as-a-node-operation` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `no-second-curation-selection` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `primitives-exist-once`
- `no-second-decimal-arithmetic` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `primitives-exist-once`
- `no-window-literal` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `no-network-or-clock` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `no-signing-or-broadcast` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `voting-is-not-fenced`
