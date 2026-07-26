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
// The next scheduled backup, anchored to the immersion-day rollover rather than
// to whenever the browser happened to start. With a 4-hour rollover and a 6-hour
// period the slots are 04:01, 10:01, 16:01 and 22:01 every day.
//
// The immersion day flips at exactly the rollover instant (04:00:00.000 above),
// so the extra minute is margin: it keeps the backup from reading storage in the
// same instant a line is being filed on the other side of the boundary.
//
// Stepping in wall-clock hours rather than fixed milliseconds keeps the slots
// where they are across a DST change.
export function nextBackupTime(
  offsetHours: number,
  periodHours: number,
  now: Date = new Date(),
): Date {
  const off = Math.min(Math.max(Math.trunc(Number(offsetHours) || 0), 0), 11);
  const period = Math.max(1, Math.trunc(Number(periodHours) || 1));
  const from = isNaN(now.getTime()) ? new Date() : now;

  const next = new Date(from.getTime());
  next.setHours(off, 1, 0, 0);
  // Today's boundary may still be ahead of us; start from the one we are past.
  if (next.getTime() > from.getTime()) next.setDate(next.getDate() - 1);
  while (next.getTime() <= from.getTime()) {
    next.setHours(next.getHours() + period);
  }
  return next;
}

export function immersionDay(
  offsetHours: number,
  when: Date = new Date(),
): string {
  const off = Math.min(Math.max(Math.trunc(Number(offsetHours) || 0), 0), 11);
  const d = isNaN(when.getTime()) ? new Date() : new Date(when.getTime());
  if (d.getHours() < off) d.setDate(d.getDate() - 1); // before rollover ⇒ previous day
  return formatISO(d, { representation: "date" });
}
