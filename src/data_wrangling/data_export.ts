import { getData, getInstanceData } from "./data_extraction";
import type { InstanceDetails } from "../storage/instance_storage";

import * as browser from "webextension-polyfill";
import { unparse } from "papaparse";

const BOM_CODE = "﻿";

// Byte Order Mark (BOM) required on Windows for displaying Japanese characters
function withBom(csv: string): string {
  return csv.startsWith(BOM_CODE) ? csv : BOM_CODE + csv;
}

// ---- CSV builders (pure of window/DOM so they work in the background too) ----

export async function buildStatsCsv(): Promise<{ csv: string; rows: number }> {
  const data = (await getData()) ?? [];
  return { csv: withBom(unparse(data)), rows: data.length };
}

export async function buildLinesCsv(
  onProgress?: (done: number, total: number) => void,
): Promise<{ csv: string; rows: number }> {
  const media = await browser.storage.local.get("media");
  if (!media.hasOwnProperty("media")) {
    return { csv: withBom(""), rows: 0 };
  }

  const uuids = Object.values(media["media"]) as string[];
  const detail_entries = await browser.storage.local.get(uuids);
  const entries = Object.entries(detail_entries) as [string, InstanceDetails][];

  // Total line count up front so the progress bar is meaningful
  const total = entries.reduce(
    (sum, [, details]) =>
      sum + Math.max(0, (details?.last_line_added ?? -1) + 1),
    0,
  );

  let rows: { [key: string]: unknown }[] = [];
  let done = 0;
  for (const entry of entries) {
    const instance_rows = await getInstanceData(entry);
    if (instance_rows) {
      rows.push(...instance_rows);
      done += instance_rows.length;
    }
    onProgress?.(done, total);
  }

  return { csv: withBom(unparse(rows)), rows: rows.length };
}

// ---- Download path (content script asks the background to do the download) ----

let isChrome =
  typeof window !== "undefined" &&
  !!window.chrome &&
  (!!window.chrome.webstore || !!window.chrome.runtime);

function csv_blob(csv: string, options: { [key: string]: string }) {
  return new Blob([withBom(csv)], options);
}

export async function blobDownload(blob: Blob, filename: string) {
  await browser.runtime.sendMessage({
    action: "download",
    url: !isChrome ? blob : URL.createObjectURL(blob),
    filename: filename,
  });
}

export async function exportStats() {
  const { csv } = await buildStatsCsv();
  await blobDownload(csv_blob(csv, { type: "text/csv" }), "exSTATic_stats.csv");
}

export async function exportLines(
  onProgress?: (done: number, total: number) => void,
) {
  const { csv } = await buildLinesCsv(onProgress);
  await blobDownload(
    csv_blob(csv, { type: "text/csv;charset=utf-8" }),
    "exSTATic_lines.csv",
  );
}
