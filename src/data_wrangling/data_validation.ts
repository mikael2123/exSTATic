import type { DataEntry } from "./data_extraction";

// Validate + normalise imported CSV data BEFORE it ever reaches storage. This is
// the root-cause fix for the Excel date corruption: dates are forced to ISO
// (YYYY-MM-DD) and same-day duplicate entries are merged, so the "duplicate
// rows / broken dates" problem can never enter storage again.

export interface ValidationReport {
  totalRows: number;
  keptRows: number;
  droppedRows: number;
  datesNormalized: number;
  duplicatesMerged: number;
  issues: string[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const SLASHED = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

export function normalizeDate(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (ISO.test(s)) return s;

  const m = SLASHED.exec(s);
  if (m) {
    let a = parseInt(m[1], 10);
    let b = parseInt(m[2], 10);
    const year = m[3];
    // Excel corruption produced M/D/YYYY (US locale). If the first field can't
    // be a month, fall back to D/M/YYYY.
    let month: number, day: number;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else {
      month = a;
      day = b;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
  }
  return null;
}

function toNum(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

export function validateStats(rows: DataEntry[]): {
  cleaned: DataEntry[];
  report: ValidationReport;
} {
  const report: ValidationReport = {
    totalRows: rows.length,
    keptRows: 0,
    droppedRows: 0,
    datesNormalized: 0,
    duplicatesMerged: 0,
    issues: [],
  };

  const seen = new Map<string, DataEntry>();
  let missing = 0;

  for (const row of rows) {
    if (
      !row ||
      row.type == null ||
      row.date == null ||
      row.given_identifier == null
    ) {
      report.droppedRows++;
      missing++;
      continue;
    }

    const norm = normalizeDate(row.date);
    if (norm == null) {
      report.droppedRows++;
      report.issues.push(`Unrecognised date "${row.date}" — row skipped.`);
      continue;
    }
    if (norm !== String(row.date).trim()) report.datesNormalized++;

    const cleaned: DataEntry = { ...row, date: norm };
    const key = `${row.client ?? ""}|${row.uuid ?? row.given_identifier}|${norm}`;

    const existing = seen.get(key);
    if (existing) {
      // Duplicate day (e.g. an ISO twin + an Excel twin). Merge by max — the
      // twins are equal, so this is lossless.
      existing.chars_read = Math.max(
        toNum(existing.chars_read),
        toNum(cleaned.chars_read),
      );
      existing.lines_read = Math.max(
        toNum(existing.lines_read),
        toNum(cleaned.lines_read),
      );
      existing.time_read = Math.max(
        toNum(existing.time_read),
        toNum(cleaned.time_read),
      );
      report.duplicatesMerged++;
    } else {
      seen.set(key, cleaned);
    }
  }

  const cleaned = Array.from(seen.values());
  report.keptRows = cleaned.length;

  if (missing)
    report.issues.push(
      `${missing} row(s) were missing type/date/name and were skipped.`,
    );
  if (report.datesNormalized)
    report.issues.push(
      `${report.datesNormalized} date(s) were not in YYYY-MM-DD format (e.g. Excel M/D/YYYY) and were converted.`,
    );
  if (report.duplicatesMerged)
    report.issues.push(
      `${report.duplicatesMerged} duplicate day entr${report.duplicatesMerged === 1 ? "y was" : "ies were"} merged.`,
    );

  return { cleaned, report };
}

export type LineRow = { [key: string]: string | number };

export function validateLines(rows: LineRow[]): {
  cleaned: LineRow[];
  report: ValidationReport;
} {
  const report: ValidationReport = {
    totalRows: rows.length,
    keptRows: 0,
    droppedRows: 0,
    datesNormalized: 0,
    duplicatesMerged: 0,
    issues: [],
  };

  let missing = 0;
  let badTime = 0;
  const cleaned: LineRow[] = [];

  for (const row of rows) {
    if (!row || row["uuid"] == null || row["line"] == null) {
      report.droppedRows++;
      missing++;
      continue;
    }
    if (isNaN(Number(row["time"]))) badTime++;
    cleaned.push(row);
  }

  // importLines expects rows in chronological order
  cleaned.sort((a, b) => (Number(a["time"]) || 0) - (Number(b["time"]) || 0));

  report.keptRows = cleaned.length;
  if (missing)
    report.issues.push(
      `${missing} row(s) were missing a uuid or line and were skipped.`,
    );
  if (badTime)
    report.issues.push(
      `${badTime} row(s) had a missing/invalid timestamp (kept, sorted last).`,
    );

  return { cleaned, report };
}
