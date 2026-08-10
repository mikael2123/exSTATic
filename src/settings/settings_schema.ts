import type { TypeProperties } from "../storage/type_storage";

// The user-facing settings that are safe to export / back up. This is the single
// source of truth for "what counts as a setting". It deliberately excludes the
// internal ids (`id`, `previous_uuid`) and everything stored outside the type
// object (Google Drive credentials/tokens, the capture toggle, etc.), so those
// can never leak into an export or a Drive backup.
export const EXPORTABLE_SETTING_KEYS = [
  "afk_max_time",
  "max_loaded_lines",
  "day_rollover_hours",
  "font",
  "font_size",
  "bottom_line_padding",
  "inactivity_blur",
  "menu_blur",
  "skip_flag_min_chars",
] as const satisfies readonly (keyof TypeProperties)[];

export type ExportableSettingKey = (typeof EXPORTABLE_SETTING_KEYS)[number];

// Human-readable labels, mirroring the descriptions shown on the settings page,
// used to render the "what will change" diff during an import.
export const SETTING_LABELS: Record<ExportableSettingKey, string> = {
  afk_max_time: "Max AFK Time",
  max_loaded_lines: "Max Loaded Lines",
  day_rollover_hours: "Day Starts At",
  font: "Font",
  font_size: "Font Size",
  bottom_line_padding: "Bottom Pushback",
  inactivity_blur: "Inactivity Blur",
  menu_blur: "Menu Blur",
  skip_flag_min_chars: "⚡ Flag Lines Over",
};
