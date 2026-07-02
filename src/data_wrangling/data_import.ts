import { TypeStorage } from "../storage/type_storage";
import { InstanceStorage, type Stat } from "../storage/instance_storage";
import { clearImmersionData, clearLineData } from "../storage/reset";

import * as browser from "webextension-polyfill";
import type { DataEntry } from "./data_extraction";
import type { LineRow } from "./data_validation";

export interface ImportOptions {
  // "force" replaces existing data instead of merging into it.
  force?: boolean;
}

// Expects rows already validated/normalised by validateStats().
export async function importStats(
  data: DataEntry[],
  options: ImportOptions = {},
) {
  if (options.force) await clearImmersionData();

  for (const entry of data) {
    // Skip malformed rows instead of aborting the whole import.
    if (
      entry.type == null ||
      entry.date == null ||
      entry.given_identifier == null
    ) {
      continue;
    }

    const type_storage = await TypeStorage.buildTypeStorage(
      entry["type"] as string,
    );
    const uuid = await type_storage.addMedia(
      entry["given_identifier"] as string,
      entry["uuid"] as string | undefined,
    );

    let stats: Stat = { chars_read: 0, time_read: 0 };
    if (entry.hasOwnProperty("chars_read")) {
      stats.chars_read = entry["chars_read"] as number;
    }
    if (entry.hasOwnProperty("lines_read")) {
      stats.lines_read = entry["lines_read"] as number;
    }
    if (entry.hasOwnProperty("time_read")) {
      stats.time_read = entry["time_read"] as number;
    }

    const instance_storage = await InstanceStorage.buildInstance(uuid);

    if (entry.hasOwnProperty("name")) {
      await instance_storage.updateDetails({
        name: entry["name"] as string | undefined,
      });
    }

    await instance_storage.addToDates(entry["date"] as string);
    await instance_storage.addToDate(
      entry["date"] as string,
      entry["client"] as string,
    );

    if (Object.keys(stats).length !== 0) {
      await instance_storage.setDailyStats(
        entry["date"] as string,
        stats,
        entry["client"] as string,
      );
    }
  }
}

// Expects rows already validated/sorted by validateLines().
export async function importLines(
  data: LineRow[],
  options: ImportOptions = {},
  onProgress?: (done: number, total: number) => void,
) {
  if (options.force) await clearLineData();

  const total = data.length;
  let done = 0;

  for (const entry of data) {
    const instance_storage = await InstanceStorage.buildInstance(
      entry["uuid"] as string,
    );

    const next_line = instance_storage.details.hasOwnProperty("last_line_added")
      ? instance_storage.details["last_line_added"] + 1
      : 0;

    const line_key = JSON.stringify([entry["uuid"], next_line]);
    const line_entry = { [line_key]: [entry["line"], entry["time"]] };
    await instance_storage.updateDetails({
      last_line_added: next_line,
    });
    await browser.storage.local.set(line_entry);

    done++;
    if (done % 500 === 0) onProgress?.(done, total);
  }
  onProgress?.(total, total);
}
