import { formatISO } from "date-fns";

// Source of information - https://en.wikipedia.org/wiki/List_of_Japanese_typographic_symbols
const IGNORE =
  /[〔〕《》〖〗〘〙〚〛【】「」［］『』｛｝\[\]()（）｟｠〈〉≪≫。、.,※＊'：！?？‥…―─ｰ〽～→♪♪ ♫ ♬ ♩\"　\t\n]/g;
const SPLIT = /[\n。.！?？]/g;

export function charsInLine(line: string) {
  return line.replaceAll(IGNORE, "").length;
}

export function lineSplitCount(line: string) {
  return line.split(SPLIT).filter((value) => value.replaceAll(IGNORE, "") != "")
    .length;
}

export function dateNowString() {
  const rn = new Date();
  return formatISO(rn, { representation: "date" });
}

export function timeToDateString(time: number) {
  if (time === undefined || isNaN(time)) return;

  const date = new Date(0);
  date.setSeconds(time);
  return formatISO(date, { representation: "date" });
}

export function timeNowSeconds() {
  const rn = new Date();
  return rn.getTime() / 1000;
}

// The "immersion day" a moment belongs to, honouring a rollover hour so that
// late-night reading counts toward the previous calendar day. Wall-clock based
// (like ッツ reader) so it is DST-robust, and total: it never throws and never
// returns an invalid date even if `offsetHours` is undefined/a string/negative.
export function immersionDay(offsetHours: number, when: Date = new Date()): string {
  const off = Math.min(Math.max(Math.trunc(Number(offsetHours) || 0), 0), 11);
  const d = isNaN(when.getTime()) ? new Date() : new Date(when.getTime());
  if (d.getHours() < off) d.setDate(d.getDate() - 1); // before rollover ⇒ previous day
  return formatISO(d, { representation: "date" });
}
