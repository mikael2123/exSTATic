import * as browser from "webextension-polyfill";
import { parse } from "papaparse";
import { exportLines, exportStats } from "./data_export";
import { validateLines, validateStats, type LineRow } from "./data_validation";
import { importLines, importStats } from "./data_import";
import type { DataEntry } from "./data_extraction";

// Snapshot current data before an import: prefer a Drive snapshot via the
// background page, else fall back to local CSV downloads. Shared by the reading
// page import and the "Import from Drive" flow so both back up identically.
export async function backupBeforeImport(): Promise<void> {
  try {
    const res: any = await browser.runtime.sendMessage({
      action: "pre_import_snapshot",
    });
    if (res && res.ok) return;
  } catch (_) {
    // fall through to a local backup
  }
  await exportStats();
  await exportLines();
}

function parseCsv<T>(text: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    parse(text, {
      header: true,
      dynamicTyping: true,
      complete: (result) => resolve(result.data as T[]),
      error: reject,
    });
  });
}

// Validate + import stats from raw CSV text. Merges, or replaces when `force`.
// The caller is responsible for backing up first and for any UI/confirmation.
export async function importStatsFromCsv(
  text: string,
  force: boolean,
): Promise<number> {
  const { cleaned } = validateStats(await parseCsv<DataEntry>(text));
  await importStats(cleaned, { force });
  return cleaned.length;
}

// Validate + import lines from raw CSV text. Merges, or replaces when `force`.
export async function importLinesFromCsv(
  text: string,
  force: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const { cleaned } = validateLines(await parseCsv<LineRow>(text));
  await importLines(cleaned, { force }, onProgress);
  return cleaned.length;
}
