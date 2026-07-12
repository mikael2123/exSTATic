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
  renameFile,
} from "./drive_client";
import { isConnected } from "./drive_auth";

// Retention: "changed-copy + flag".
// - unchanged                  -> skip
// - grew (bigger + more rows)  -> overwrite the active backup file in place
// - anything else (shrank /    -> keep the previous backup as a dated snapshot,
//   rows dropped / same size      write the current data as a fresh active file,
//   different content)            and raise an alert for the user to inspect.

interface BackupMeta {
  fileId: string;
  length: number;
  hash: string;
  rows: number;
  updatedAt: string;
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
): Promise<BackupStatus> {
  const hash = await sha256Hex(csv);
  const length = csv.length;
  const prev = index[key];
  const now = new Date().toISOString();

  if (!prev) {
    const fileId = await createFile(folderId, activeName, csv);
    index[key] = { fileId, length, hash, rows, updatedAt: now };
    return "created";
  }

  if (hash === prev.hash) return "skipped";

  const grew = length > prev.length && rows >= prev.rows;
  if (grew) {
    await updateFileContent(prev.fileId, csv);
    index[key] = { fileId: prev.fileId, length, hash, rows, updatedAt: now };
    return "updated";
  }

  // Non-append change: preserve the old backup, start a fresh active file, flag.
  const snapshotName =
    activeName.replace(/\.csv$/, "") + `_snapshot_${stamp()}.csv`;
  await renameFile(prev.fileId, snapshotName);
  const fileId = await createFile(folderId, activeName, csv);
  index[key] = { fileId, length, hash, rows, updatedAt: now };
  return "flagged";
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
    const statsStatus = await backupOne(
      await ensureStatsFolder(),
      index,
      "stats",
      "exSTATic_stats.csv",
      stats.csv,
      stats.rows,
    );

    const lines = await buildLinesCsv();
    const linesStatus = await backupOne(
      await ensureLinesFolder(),
      index,
      "lines",
      "exSTATic_lines.csv",
      lines.csv,
      lines.rows,
    );

    const settingsStatus = await backupSettings(
      await ensureSettingsFolder(),
      index,
    );

    await browser.storage.local.set({
      backup_index: index,
      backup_last_run: new Date().toISOString(),
    });

    if (statsStatus === "flagged" || linesStatus === "flagged") {
      const alert =
        `Backup on ${new Date().toLocaleString()} saw an unexpected change ` +
        `(stats: ${statsStatus}, lines: ${linesStatus}). ` +
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
