import * as browser from "webextension-polyfill";

// Keys that are NOT immersion data and must survive a "replace all" import:
// the client id, schema version, capture toggle, the type list, per-type
// settings, and all Google Drive / backup configuration.
const ALWAYS_PRESERVE = new Set([
  "client",
  "schema_version",
  "listen_status",
  "types",
  "gdrive_client_id",
  "gdrive_client_secret",
  "gdrive_refresh_token",
  "gdrive_access_token",
  "gdrive_token_expiry",
  "backup_index",
  "backup_last_run",
  "backup_alert",
]);

// Wipe ALL immersion data (media, per-day stats, line text, date lists) while
// keeping settings + backup config. Used by "force import stats (replace all)".
export async function clearImmersionData(): Promise<void> {
  const all = await browser.storage.local.get(null);

  const preserve = new Set(ALWAYS_PRESERVE);
  const types = Array.isArray(all["types"]) ? (all["types"] as string[]) : [];
  for (const type of types) preserve.add(type); // per-type settings object

  const toRemove = Object.keys(all).filter((key) => !preserve.has(key));
  if (toRemove.length) await browser.storage.local.remove(toRemove);
}

// Remove only stored line text (["uuid", lineId] entries) and reset each
// media's last_line_added. Keeps stats/media. Used by "force import lines".
export async function clearLineData(): Promise<void> {
  const all = await browser.storage.local.get(null);

  const toRemove: string[] = [];
  for (const key of Object.keys(all)) {
    if (!key.startsWith("[")) continue;
    try {
      const parsed = JSON.parse(key);
      // Line keys are ["uuid", <number>]; stat keys are [client, uuid, date].
      if (
        Array.isArray(parsed) &&
        parsed.length === 2 &&
        typeof parsed[1] === "number"
      ) {
        toRemove.push(key);
      }
    } catch {
      // not a JSON key, ignore
    }
  }
  if (toRemove.length) await browser.storage.local.remove(toRemove);

  // Reset last_line_added on every known media so imports start from 0.
  const media = (all["media"] as { [k: string]: string }) ?? {};
  const updates: { [uuid: string]: unknown } = {};
  for (const uuid of Object.values(media)) {
    const details = all[uuid];
    if (details && typeof details === "object") {
      updates[uuid] = { ...details, last_line_added: -1 };
    }
  }
  if (Object.keys(updates).length) await browser.storage.local.set(updates);
}
