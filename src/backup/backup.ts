import * as browser from "webextension-polyfill";
import { buildStatsCsv, buildLinesCsv } from "../data_wrangling/data_export";
import {
  buildSettingsPayload,
  serializeSettingsFile,
  settingsHashInput,
} from "../data_wrangling/settings_io";
import {
  ensureStatsFolder,
  ensureLinesFolder,
  ensureSettingsFolder,
  createFile,
  updateFileContent,
  copyFile,
  downloadFileText,
} from "./drive_client";
import { isConnected } from "./drive_auth";
import {
  parseStatsCsv,
  compareStats,
  compareLineCounts,
  isSafeChange,
  type ChangeSummary,
} from "./change_check";

// Retention: "changed-copy + flag".
// - unchanged                  -> skip
// - grew (bigger + more rows)  -> overwrite the active backup file in place
// - anything else (shrank /    -> copy the previous backup aside as a dated
//   rows dropped / same size      snapshot, overwrite the active file in place,
//   different content)            and raise an alert for the user to inspect.
//
// Both write paths update the active file by its existing fileId and never
// re-create it, so its name and id are stable for the lifetime of the backup.

interface BackupMeta {
  fileId: string;
  length: number;
  hash: string;
  rows: number;
  updatedAt: string;
  // Lines only: per-media line counts, compared instead of re-downloading the
  // (very large) lines CSV. Absent on indexes written before this existed.
  lineCounts?: { [uuid: string]: number };
}
// Settings backups are versioned (a new timestamped file per change), so they
// only need the latest file id + content hash for change-detection.
interface SettingsBackupMeta {
  fileId: string;
  hash: string;
  updatedAt: string;
}
interface BackupIndex {
  stats?: BackupMeta;
  lines?: BackupMeta;
  settings?: SettingsBackupMeta;
}

type BackupStatus = "skipped" | "updated" | "created" | "flagged";

interface BackupOutcome {
  status: BackupStatus;
  summary?: ChangeSummary;
}

interface Verdict {
  safe: boolean;
  summary?: ChangeSummary;
}

// Decides whether the change since the last backup is expected. Per-type,
// because stats and lines are compared by different means.
type Classifier = (prev: BackupMeta) => Promise<Verdict>;

// The original heuristic, kept only as a fallback for when a keyed comparison
// isn't possible: the first run after the change check was added (no stored
// fingerprint yet) or a Drive read that failed. It errs towards flagging.
function grewByBytes(prev: BackupMeta, length: number, rows: number): Verdict {
  return { safe: length > prev.length && rows >= prev.rows };
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function backupOne(
  folderId: string,
  index: BackupIndex,
  key: "stats" | "lines",
  activeName: string,
  csv: string,
  rows: number,
  classify: Classifier,
  meta: Partial<BackupMeta> = {},
): Promise<BackupOutcome> {
  const hash = await sha256Hex(csv);
  const length = csv.length;
  const prev = index[key];
  const now = new Date().toISOString();

  const record = (fileId: string) => {
    index[key] = { fileId, length, hash, rows, updatedAt: now, ...meta };
  };

  if (!prev) {
    record(await createFile(folderId, activeName, csv));
    return { status: "created" };
  }

  if (hash === prev.hash) return { status: "skipped" };

  const verdict = await classify(prev);
  if (verdict.safe) {
    await updateFileContent(prev.fileId, csv);
    record(prev.fileId);
    return { status: "updated" };
  }

  // Non-append change: preserve the old backup, then overwrite in place, flag.
  //
  // The snapshot is a *copy* of the previous file rather than a rename of it,
  // so the active file keeps its name and fileId. Renaming it and creating a
  // replacement briefly left two files wanting the same name; Drive allows that
  // (it keys on fileId) but Google Drive for Desktop cannot, so the local mirror
  // was left as "exSTATic_stats (1).csv" and never renamed back, breaking tools
  // that read it by name.
  //
  // Copy before update: if the update then fails, the old content still exists
  // in both files. Updating first would destroy it if the copy failed.
  const snapshotName =
    activeName.replace(/\.csv$/, "") + `_snapshot_${stamp()}.csv`;
  await copyFile(prev.fileId, snapshotName, folderId);
  await updateFileContent(prev.fileId, csv);
  record(prev.fileId);
  return { status: "flagged", summary: verdict.summary };
}

// Settings aren't append-only like the CSVs, so an in-place overwrite would lose
// history. Instead, when the settings change we write a brand-new timestamped
// file (keeping every version), and skip entirely when nothing changed.
async function backupSettings(
  settingsFolderId: string,
  index: BackupIndex,
): Promise<BackupStatus> {
  const payload = await buildSettingsPayload();
  const hash = await sha256Hex(settingsHashInput(payload));
  const prev = index.settings;

  if (prev && hash === prev.hash) return "skipped";

  const name = `exSTATic_settings_${stamp()}.json`;
  const fileId = await createFile(
    settingsFolderId,
    name,
    serializeSettingsFile(payload),
    "application/json",
  );
  index.settings = { fileId, hash, updatedAt: new Date().toISOString() };
  return "created";
}

export async function runBackup(
  reason: string = "scheduled",
): Promise<{
  ok: boolean;
  error?: string;
  results?: {
    reason: string;
    stats: BackupStatus;
    lines: BackupStatus;
    settings: BackupStatus;
  };
}> {
  if (!(await isConnected())) {
    return { ok: false, error: "Google Drive is not connected." };
  }

  try {
    const stored = await browser.storage.local.get("backup_index");
    const index: BackupIndex = (stored["backup_index"] as BackupIndex) ?? {};

    const stats = await buildStatsCsv();
    const statsOutcome = await backupOne(
      await ensureStatsFolder(),
      index,
      "stats",
      "exSTATic_stats.csv",
      stats.csv,
      stats.rows,
      // Small enough (~80 KB) to re-read the previous backup and compare it row
      // by row. That is authoritative — it checks against what is actually on
      // Drive rather than a local record that could have drifted from it — and
      // it is the same content the flag diff needs.
      async (prev) => {
        try {
          const summary = compareStats(
            parseStatsCsv(await downloadFileText(prev.fileId)),
            parseStatsCsv(stats.csv),
          );
          return { safe: isSafeChange(summary), summary };
        } catch (_) {
          return grewByBytes(prev, stats.csv.length, stats.rows);
        }
      },
    );
    const statsStatus = statsOutcome.status;

    const lines = await buildLinesCsv();
    const linesOutcome = await backupOne(
      await ensureLinesFolder(),
      index,
      "lines",
      "exSTATic_lines.csv",
      lines.csv,
      lines.rows,
      // Too large to re-download, so per-media line counts recorded on the last
      // run are the reference instead.
      async (prev) => {
        if (!prev.lineCounts) {
          return grewByBytes(prev, lines.csv.length, lines.rows);
        }
        const summary = compareLineCounts(
          prev.lineCounts,
          lines.counts,
          lines.names,
        );
        return { safe: isSafeChange(summary), summary };
      },
      { lineCounts: lines.counts },
    );
    const linesStatus = linesOutcome.status;

    const settingsStatus = await backupSettings(
      await ensureSettingsFolder(),
      index,
    );

    await browser.storage.local.set({
      backup_index: index,
      backup_last_run: new Date().toISOString(),
    });

    if (statsStatus === "flagged" || linesStatus === "flagged") {
      const summaries = [statsOutcome.summary, linesOutcome.summary].filter(
        (s): s is ChangeSummary => !!s,
      );
      const unexpected = summaries.reduce(
        (n, s) => n + s.removed.length + s.decreased.length,
        0,
      );
      const detail = unexpected
        ? ` ${unexpected} ${unexpected === 1 ? "entry" : "entries"} went backwards or disappeared.`
        : "";
      const alert =
        `Backup on ${new Date().toLocaleString()} saw an unexpected change ` +
        `(stats: ${statsStatus}, lines: ${linesStatus}).${detail} ` +
        `A dated snapshot of the previous backup was kept in Google Drive so nothing is lost.`;
      await browser.storage.local.set({ backup_alert: alert });
      try {
        await browser.notifications.create({
          type: "basic",
          iconUrl: browser.runtime.getURL("docs/favicon_100x100.png"),
          title: "exSTATic backup — please check your data",
          message: alert,
        });
      } catch (_) {
        // notifications are best-effort
      }
    }

    return {
      ok: true,
      results: {
        reason,
        stats: statsStatus,
        lines: linesStatus,
        settings: settingsStatus,
      },
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

// A lightweight settings-only backup, used right before a settings import so the
// previous state is versioned on Drive without rebuilding the large lines CSV.
export async function runSettingsBackup(
  reason: string = "manual",
): Promise<{
  ok: boolean;
  error?: string;
  results?: { reason: string; settings: BackupStatus };
}> {
  if (!(await isConnected())) {
    return { ok: false, error: "Google Drive is not connected." };
  }

  try {
    const stored = await browser.storage.local.get("backup_index");
    const index: BackupIndex = (stored["backup_index"] as BackupIndex) ?? {};

    const settingsStatus = await backupSettings(
      await ensureSettingsFolder(),
      index,
    );

    await browser.storage.local.set({ backup_index: index });
    return { ok: true, results: { reason, settings: settingsStatus } };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
