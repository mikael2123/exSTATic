// Fonts offered in the font picker dropdown. Pure data (no side effects) so it
// can be imported anywhere without triggering font loading in fonts.ts.
//
// The first two are bundled with the extension (loaded in fonts.ts); the rest
// are common Windows Japanese system fonts. Users can still type any installed
// font name via the "Custom…" option.
export const AVAILABLE_FONTS = [
  "Klee One",
  "Noto Sans JP",
  "Meiryo",
  "Yu Gothic UI",
  "Yu Gothic",
  "MS Gothic",
  "MS PGothic",
  "Yu Mincho",
  "MS Mincho",
];
