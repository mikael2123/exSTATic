console.log("exSTATic");

import { message_action } from "./messaging/message_actions";
import {
  connectionClosed,
  connectionOpened,
  dataFetched,
  messagingConnected,
} from "./messaging/socket_actions";
import { runBackup, runSettingsBackup } from "./backup/backup";
import {
  connectDrive,
  disconnectDrive,
  getRedirectUri,
  isConnected,
} from "./backup/drive_auth";
import {
  downloadFileText,
  ensureStatsFolder,
  ensureLinesFolder,
  ensureSettingsFolder,
  listFiles,
} from "./backup/drive_client";

import * as browser from "webextension-polyfill";
import type { Tabs } from "webextension-polyfill";
import ReconnectingWebSocket from "reconnecting-websocket";

declare global {
  interface Window {
    chrome:
      | {
          runtime: object | undefined;
          webstore: object | undefined;
        }
      | undefined;
  }
  interface DocumentEventMap {
    media_changed: CustomEvent;
    new_line: CustomEvent;
    "ttsu:page.change": CustomEvent;
  }
}

const reloadTab = async (tab: Tabs.Tab) => {
  if (!tab.id) return;
  browser.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.location.reload(),
  });
};

// Run a function with each tab that has a content script
const runOnContentScripts = async (func: (tab: Tabs.Tab) => void) => {
  for (const content_script of browser.runtime.getManifest().content_scripts ??
    []) {
    for (const tab of await browser.tabs.query({ url: content_script.matches }))
      func(tab);
  }
};

browser.runtime.onUpdateAvailable.addListener(() => browser.runtime.reload());
browser.runtime.onInstalled.addListener(async () => {
  if (!(await browser.storage.local.get("client"))["client"])
    await browser.storage.local.set({ client: crypto.randomUUID() });

  console.log(
    "Client UUID: " + (await browser.storage.local.get("client"))["client"],
  );

  if (!(await browser.storage.local.get("schema_version"))["schema_version"])
    await browser.storage.local.set({ schema_version: 2 });

  console.log("Reloading all extension tabs...");
  runOnContentScripts(reloadTab);
});

// Backup scheduling: an alarm wakes the (non-persistent) background page even
// when no exSTATic page is open, and runs regardless of the capture toggle.
const BACKUP_ALARM = "daily_backup";
const ensureBackupAlarm = async () => {
  if (!(await browser.alarms.get(BACKUP_ALARM))) {
    // Fires roughly every 6h; a missed alarm fires on the next browser start.
    browser.alarms.create(BACKUP_ALARM, { periodInMinutes: 360 });
  }
};
ensureBackupAlarm();
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BACKUP_ALARM) runBackup("scheduled");
});

const driveStatus = async () => {
  const s = await browser.storage.local.get([
    "backup_last_run",
    "backup_alert",
    "gdrive_client_id",
  ]);
  return {
    connected: await isConnected(),
    redirectUri: getRedirectUri(),
    lastRun: s["backup_last_run"] ?? null,
    alert: s["backup_alert"] ?? null,
    hasClientId: !!s["gdrive_client_id"],
  };
};

// Resolve the latest stats + lines backup CSVs from Google Drive: prefer the
// exact file ids recorded in backup_index, and fall back to listing the
// backups folder (e.g. a fresh profile that lost local storage but whose
// Drive files still exist) and matching by the naming convention used in
// backup.ts ("exSTATic_stats.csv" / "exSTATic_lines.csv").
const fetchLatestFromDrive = async (): Promise<
  | { ok: true; statsCsv?: string; linesCsv?: string }
  | { ok: false; error: string }
> => {
  try {
    const stored = await browser.storage.local.get("backup_index");
    const index =
      (stored["backup_index"] as
        | { stats?: { fileId: string }; lines?: { fileId: string } }
        | undefined) ?? {};

    let statsFileId = index.stats?.fileId;
    let linesFileId = index.lines?.fileId;

    if (!statsFileId) {
      const files = await listFiles(await ensureStatsFolder());
      statsFileId = files.find((f) =>
        f.name.toLowerCase().includes("stats"),
      )?.id;
    }
    if (!linesFileId) {
      const files = await listFiles(await ensureLinesFolder());
      linesFileId = files.find((f) =>
        f.name.toLowerCase().includes("lines"),
      )?.id;
    }

    if (!statsFileId && !linesFileId) {
      return {
        ok: false,
        error: 'No Drive backup found — use "Backup now" first.',
      };
    }

    const statsCsv = statsFileId
      ? await downloadFileText(statsFileId)
      : undefined;
    const linesCsv = linesFileId
      ? await downloadFileText(linesFileId)
      : undefined;

    return { ok: true, statsCsv, linesCsv };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
};

// Resolve the latest settings backup JSON from Google Drive: prefer the file id
// recorded in backup_index, else list the settings subfolder (newest first) and
// take the most recent exSTATic_settings_*.json.
const fetchSettingsFromDrive = async (): Promise<
  { ok: true; settingsJson: string } | { ok: false; error: string }
> => {
  try {
    const stored = await browser.storage.local.get("backup_index");
    const index =
      (stored["backup_index"] as
        | { settings?: { fileId: string } }
        | undefined) ?? {};

    let fileId = index.settings?.fileId;
    if (!fileId) {
      const files = await listFiles(await ensureSettingsFolder());
      fileId = files.find((f) => f.name.toLowerCase().includes("settings"))?.id;
    }

    if (!fileId) {
      return {
        ok: false,
        error: 'No settings backup found on Drive — use "Backup now" first.',
      };
    }

    const settingsJson = await downloadFileText(fileId);
    return { ok: true, settingsJson };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
};

// Message passing is used for actions which can only be performed on the
// background page (downloads, identity/OAuth, Drive fetches, alarms).
browser.runtime.onMessage.addListener((message: any) => {
  switch (message?.action) {
    case "open_tab":
    case "download":
      return message_action(message);
    case "drive_get_redirect_uri":
      return Promise.resolve({ redirectUri: getRedirectUri() });
    case "drive_status":
      return driveStatus();
    case "drive_connect":
      return connectDrive();
    case "drive_disconnect":
      return disconnectDrive().then(() => ({ ok: true }));
    case "backup_now":
      return runBackup("manual");
    case "pre_import_snapshot":
      return runBackup("pre_import");
    case "drive_fetch_latest":
      return fetchLatestFromDrive();
    case "drive_fetch_settings":
      return fetchSettingsFromDrive();
    case "backup_settings_now":
      return runSettingsBackup("pre_import");
    case "set_listen_status":
      return applyListenStatus(message.listening === true);
    case "get_listen_status":
      return isListening().then((listening) => ({ listening }));
  }
  return undefined;
});

// Capture toggle. The toolbar icon and the tracker page's pause button drive
// this same flag, so the two can never disagree about whether we're recording.
const isListening = async () => {
  const status = (await browser.storage.local.get("listen_status"))[
    "listen_status"
  ];
  return status == true || status === undefined;
};

const applyListenStatus = async (listening: boolean) => {
  await browser.action.setIcon({
    path: listening
      ? { "100": "/docs/favicon_100x100.png", "500": "/docs/favicon.png" }
      : { "100": "/docs/disabled_100x100.png", "500": "/docs/disabled.png" },
  });
  await browser.storage.local.set({ listen_status: listening });
  return { ok: true, listening };
};

// The flag persists across restarts, so restore the icon to match it — a paused
// profile must not come back looking like it is recording.
isListening().then(applyListenStatus);

browser.action.onClicked.addListener(async () => {
  await applyListenStatus(!(await isListening()));
});

let socket = new ReconnectingWebSocket("ws://localhost:9001");

socket.addEventListener("open", connectionOpened);
socket.addEventListener("close", connectionClosed);
socket.addEventListener("error", connectionClosed);
socket.addEventListener("message", (event: MessageEvent) => {
  dataFetched(event);
});

browser.runtime.onConnect.addListener(messagingConnected);
