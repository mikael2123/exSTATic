import { parse } from "papaparse";

// Deciding whether a backup's changes are expected.
//
// The old rule compared serialised byte length ("did the file get bigger?").
// That is unsound: same-day rows are updated in place rather than appended, and
// read_speed is a derived float whose text width varies run to run, so a day
// that grew in every real dimension could still shrink the file by a byte and
// raise a false alarm.
//
// Instead, rows are keyed by identity and compared as numbers. A change is
// expected when nothing disappeared and no cumulative total went backwards;
// everything else is flagged for the user to look at.

export interface FieldChange {
  label: string;
  field: string;
  from: number;
  to: number;
}

export interface ChangeSummary {
  added: string[];
  removed: string[];
  increased: FieldChange[];
  decreased: FieldChange[];
}

export function emptySummary(): ChangeSummary {
  return { added: [], removed: [], increased: [], decreased: [] };
}

// A change is safe when nothing vanished and nothing counted down. Additions and
// increases are the normal shape of reading more.
export function isSafeChange(summary: ChangeSummary): boolean {
  return summary.removed.length === 0 && summary.decreased.length === 0;
}

export function changeCount(summary: ChangeSummary): number {
  return (
    summary.added.length +
    summary.removed.length +
    summary.increased.length +
    summary.decreased.length
  );
}

// ---- stats ----

// Cumulative per-day totals, which can only ever grow. read_speed is excluded on
// purpose: it is recomputed from these two on every export, so it carries no
// information of its own and its float width is what caused the false alarms.
const MONOTONIC_FIELDS = ["chars_read", "lines_read", "time_read"] as const;
type MonotonicField = (typeof MONOTONIC_FIELDS)[number];

export type StatsRow = { label: string } & Record<MonotonicField, number>;

function num(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
}

// Keyed by [client, uuid, date] — the same triple the daily stats are stored
// under, so one media read by two clients on one day stays two distinct rows.
export function parseStatsCsv(csv: string): Map<string, StatsRow> {
  const { data } = parse<Record<string, string>>(csv.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: true,
  });

  const rows = new Map<string, StatsRow>();
  for (const row of data) {
    if (!row || !row["uuid"] || !row["date"]) continue;
    const name = row["name"] || row["given_identifier"] || row["uuid"];
    rows.set(`${row["client"] ?? ""}|${row["uuid"]}|${row["date"]}`, {
      label: `${name} — ${row["date"]}`,
      chars_read: num(row["chars_read"]),
      lines_read: num(row["lines_read"]),
      time_read: num(row["time_read"]),
    });
  }
  return rows;
}

// Order-independent: rows are matched by key, so re-ordering the file (an import
// rebuilds immersion_dates in CSV order) is not a change at all.
export function compareStats(
  prev: Map<string, StatsRow>,
  next: Map<string, StatsRow>,
): ChangeSummary {
  const summary = emptySummary();

  for (const [key, row] of next) {
    const before = prev.get(key);
    if (!before) {
      summary.added.push(row.label);
      continue;
    }
    for (const field of MONOTONIC_FIELDS) {
      const from = before[field];
      const to = row[field];
      if (to === from) continue;
      const change = { label: row.label, field, from, to };
      if (to < from) summary.decreased.push(change);
      else summary.increased.push(change);
    }
  }

  for (const [key, row] of prev) {
    if (!next.has(key)) summary.removed.push(row.label);
  }

  return summary;
}

// ---- lines ----

// The lines CSV is grouped by media registration order, so new lines land in the
// middle of the file rather than at the end, and at ~36 MB it is far too large to
// re-download for a row-level comparison. Per-media line counts are compact
// enough to keep in the backup index and catch the case that matters: lines
// disappearing. An edit to an existing line would slip through, which is
// acceptable because lines are written once by index and only removed wholesale.
export function compareLineCounts(
  prev: { [uuid: string]: number },
  next: { [uuid: string]: number },
  labels: { [uuid: string]: string } = {},
): ChangeSummary {
  const summary = emptySummary();
  const label = (uuid: string) => labels[uuid] ?? uuid;

  for (const [uuid, count] of Object.entries(next)) {
    const before = prev[uuid];
    if (before === undefined) {
      summary.added.push(label(uuid));
      continue;
    }
    if (count === before) continue;
    const change = { label: label(uuid), field: "lines", from: before, to: count };
    if (count < before) summary.decreased.push(change);
    else summary.increased.push(change);
  }

  for (const uuid of Object.keys(prev)) {
    if (!(uuid in next)) summary.removed.push(label(uuid));
  }

  return summary;
}
