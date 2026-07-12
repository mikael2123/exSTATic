import * as browser from "webextension-polyfill";
import { TypeStorage, type TypeProperties } from "../storage/type_storage";
import { blobDownload } from "./data_export";
import {
  EXPORTABLE_SETTING_KEYS,
  SETTING_LABELS,
  type ExportableSettingKey,
} from "../settings/settings_schema";

export const SETTINGS_FORMAT_VERSION = 1;

export interface SettingsPayload {
  types: { [type: string]: Partial<TypeProperties> };
}

export interface SettingsFile extends SettingsPayload {
  exstatic_settings: number;
  exported_at: string;
}

// Keep only the exportable keys that are actually present on a stored type
// object. Anything else (ids, unknown fields) is dropped.
function pickExportable(obj: unknown): Partial<TypeProperties> {
  const out: Partial<TypeProperties> = {};
  if (!obj || typeof obj !== "object") return out;
  for (const key of EXPORTABLE_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      (out as Record<string, unknown>)[key] = (obj as Record<string, unknown>)[
        key
      ];
    }
  }
  return out;
}

// Build a payload of exportable settings for every registered media type.
// Reads ONLY the per-type objects and picks ONLY the exportable keys, so Drive
// credentials / tokens / the capture toggle / internal ids are never included.
export async function buildSettingsPayload(): Promise<SettingsPayload> {
  const stored = await browser.storage.local.get("types");
  const types: string[] = Array.isArray(stored["types"]) ? stored["types"] : [];

  const payload: SettingsPayload = { types: {} };
  if (types.length === 0) return payload;

  const typeObjects = await browser.storage.local.get(types);
  for (const type of types) {
    payload.types[type] = pickExportable(typeObjects[type]);
  }
  return payload;
}

// Deterministic, timestamp-free serialization of just the settings, used for
// change-detection so an unchanged settings state hashes identically each run.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
      .join(",") +
    "}"
  );
}

export function settingsHashInput(payload: SettingsPayload): string {
  return stableStringify(payload.types);
}

// Full export file: version + human timestamp + the settings. Pretty-printed.
export function serializeSettingsFile(payload: SettingsPayload): string {
  const file: SettingsFile = {
    exstatic_settings: SETTINGS_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    types: payload.types,
  };
  return JSON.stringify(file, null, 2);
}

export interface ParsedSettings {
  payload: SettingsPayload;
  issues: string[];
}

// Parse + sanitize a settings file. Throws only when the file clearly isn't an
// exSTATic settings export; otherwise unknown keys/types and malformed values
// are dropped and noted in `issues`.
export function parseSettingsFile(text: string): ParsedSettings {
  const issues: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(
      "This file isn't valid JSON — is it an exSTATic settings export?",
    );
  }

  if (
    !raw ||
    typeof raw !== "object" ||
    typeof (raw as { types?: unknown }).types !== "object" ||
    (raw as { types?: unknown }).types === null
  ) {
    throw new Error(
      'This doesn\'t look like an exSTATic settings export (missing "types").',
    );
  }

  const rawObj = raw as { exstatic_settings?: unknown; types: Record<string, unknown> };

  if (
    rawObj.exstatic_settings !== undefined &&
    rawObj.exstatic_settings !== SETTINGS_FORMAT_VERSION
  ) {
    issues.push(
      `File format version ${rawObj.exstatic_settings} differs from the expected ${SETTINGS_FORMAT_VERSION}; unrecognized fields are ignored.`,
    );
  }

  const exportable = EXPORTABLE_SETTING_KEYS as readonly string[];
  const payload: SettingsPayload = { types: {} };

  for (const [type, obj] of Object.entries(rawObj.types)) {
    if (!obj || typeof obj !== "object") {
      issues.push(`Skipped "${type}": its settings weren't an object.`);
      continue;
    }
    const picked: Partial<TypeProperties> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (!exportable.includes(key)) {
        issues.push(`Ignored unknown setting "${key}".`);
        continue;
      }
      if (value !== null && typeof value === "object") {
        issues.push(`Ignored "${key}": unexpected value.`);
        continue;
      }
      (picked as Record<string, unknown>)[key] = value;
    }
    payload.types[type] = picked;
  }

  return { payload, issues };
}

export interface SettingsDiff {
  changes: string[];
  hasChanges: boolean;
}

function formatValue(v: unknown): string {
  if (v === undefined || v === null || v === "") return "(unset)";
  return String(v);
}

// Compare an incoming payload against the currently stored settings and produce
// human-readable change lines. Unchanged keys are omitted.
export async function diffSettings(
  payload: SettingsPayload,
): Promise<SettingsDiff> {
  const changes: string[] = [];
  const types = Object.keys(payload.types);
  const current = types.length ? await browser.storage.local.get(types) : {};
  const multiType = types.length > 1;

  for (const type of types) {
    const incoming = (payload.types[type] ?? {}) as Record<string, unknown>;
    const existing = (current[type] as Record<string, unknown>) ?? {};
    for (const key of EXPORTABLE_SETTING_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(incoming, key)) continue;
      const newVal = incoming[key];
      const oldVal = existing[key];
      // Values are stored as strings via the settings UI, so compare loosely.
      if (String(oldVal ?? "") === String(newVal ?? "")) continue;
      const label =
        SETTING_LABELS[key as ExportableSettingKey] +
        (multiType ? ` [${type}]` : "");
      changes.push(`${label}: ${formatValue(oldVal)} → ${formatValue(newVal)}`);
    }
  }

  return { changes, hasChanges: changes.length > 0 };
}

// Apply an incoming payload by merging its exportable keys into each type's
// stored properties. Leaves id/previous_uuid and any non-exported keys intact.
export async function applySettings(payload: SettingsPayload): Promise<void> {
  for (const [type, incoming] of Object.entries(payload.types)) {
    const picked: Partial<TypeProperties> = {};
    for (const key of EXPORTABLE_SETTING_KEYS) {
      if (Object.prototype.hasOwnProperty.call(incoming, key)) {
        (picked as Record<string, unknown>)[key] = (
          incoming as Record<string, unknown>
        )[key];
      }
    }
    if (Object.keys(picked).length === 0) continue;
    const storage = await TypeStorage.buildTypeStorage(type);
    await storage.updateProperties(picked);
  }
}

// Download the current settings as a JSON file (no BOM — that's CSV-only here).
export async function exportSettings(): Promise<void> {
  const payload = await buildSettingsPayload();
  const json = serializeSettingsFile(payload);
  await blobDownload(
    new Blob([json], { type: "application/json" }),
    "exSTATic_settings.json",
  );
}
