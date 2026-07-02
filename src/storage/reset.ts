import * as browser from "webextension-polyfill";

// Remove only per-day stats + the date lists, keeping media details and all
// stored line text. Used by "force import stats (replace all stats)" so a stats
// replace never destroys line data.
export async function clearStatsData(): Promise<void> {
  const all = await browser.storage.local.get(null);
  const toRemove: string[] = [];

  // Per-date list keys (value = [[client, uuid], ...]) are enumerated here.
  const dates = Array.isArray(all["immersion_dates"])
    ? (all["immersion_dates"] as string[])
    : [];
  for (const date of dates) {
    if (date in all) toRemove.push(date);
  }
  if ("immersion_dates" in all) toRemove.push("immersion_dates");

  // Daily-stat keys are ["client", "uuid", "date"] (length-3 JSON arrays);
  // line keys are ["uuid", <number>] (length 2) and are left untouched.
  for (const key of Object.keys(all)) {
    if (!key.startsWith("[")) continue;
    try {
      const parsed = JSON.parse(key);
      if (Array.isArray(parsed) && parsed.length === 3) toRemove.push(key);
    } catch {
      // not a JSON key, ignore
    }
  }

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
