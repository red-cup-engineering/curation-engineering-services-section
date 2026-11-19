import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { append, logDates, readLog, sealLogs, withFileLock } from "@red-cup-engineering/semiotic-eavt-engineering-services-section/store";

const feed = "hive-shadow-curation";
const day = 86_400_000;
const locked = (root, callback) => withFileLock(join(root, ".curation-journal.lock"), callback);

function optionalRead(file) {
  try { return readFileSync(file); }
  catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** Read the original observations once, followed by the SEAVT log in receipt order. */
export function readShadowRows(data) {
  const root = resolve(data);
  return locked(root, () => {
    const original = join(root, "journal.jsonl");
    const archived = optionalRead(`${original}.gz`);
    const legacy = archived === undefined ? optionalRead(original) : gunzipSync(archived);
    const rows = legacy === undefined ? [] : legacy.toString("utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
    for (const date of logDates(root, feed)) {
      for (const { line } of readLog(root, feed, date)) rows.push(line.row);
    }
    return rows;
  });
}

/** Each submitted batch follows the existing feed and leaves SEAVT's byte cursors valid. */
export function appendShadowRows(data, rows, observedAt) {
  if (rows.length === 0) return;
  const root = resolve(data);
  locked(root, () => {
    let at = observedAt;
    for (const date of logDates(root, feed)) {
      if (date > at.slice(0, 10)) at = `${date}T00:00:00.000Z`;
    }
    for (const row of rows) append(root, feed, { at, row }, { seal: false });
  });
}

/** Seal the completed polling pass, including the open tail of the current day. */
export function sealShadowRows(data, now) {
  const root = resolve(data);
  return locked(root, () => {
    let last = now.toISOString().slice(0, 10);
    for (const date of logDates(root, feed)) last = date > last ? date : last;
    return sealLogs(root, feed, { before: new Date(Date.parse(last) + day).toISOString().slice(0, 10) });
  });
}
