import * as browser from "webextension-polyfill";
import { charsInLine, lineSplitCount, timeToDateString } from "../calculations";
import type { InstanceStorage, Stat } from "../storage/instance_storage";
import { MediaStorage } from "../storage/media_storage";
import type { TypeStorage } from "../storage/type_storage";

// EXTENDED STORAGE SPEC
//     "uuid": {
//         "last_line_added": "line_id",
//         ...
//     }

export class VNStorage extends MediaStorage {
  max_lines: number;

  constructor(
    type_storage: TypeStorage,
    instance_storage?: InstanceStorage,
    live_stat_update = false,
  ) {
    super(type_storage, instance_storage, live_stat_update);
    this.max_lines = Number.parseInt(type_storage.properties.max_loaded_lines);
    this.logLines();
  }

  static async build(live_stat_update = false) {
    const media_storage = await super.buildMediaStorage("vn");
    return new VNStorage(
      media_storage.type_storage,
      media_storage.instance_storage,
      live_stat_update,
    );
  }

  async logLines() {
    if (!this.uuid || !this.details || !this.instance_storage) return;

    const event = new CustomEvent("media_changed", {
      detail: {
        uuid: this.uuid,
        name: this.details.name,
        lines: await this.instance_storage.getLines(this.max_lines),
      },
    });
    document.dispatchEvent(event);
  }

  async addLine(line: string, date: string, time: number) {
    const previous_line_key = JSON.stringify([
      this.uuid,
      this.details!.last_line_added,
    ]);
    const previous_line = (await browser.storage.local.get(previous_line_key))[
      previous_line_key
    ];

    if (previous_line == undefined || line != previous_line[0]) {
      const chars_in_line = charsInLine(line);
      if (chars_in_line === 0) return;

      this.start_ticker(false);

      // Resolve the immersion day once (from the event's own timestamp) and use
      // it for the line entry and every daily bucket, so they can never diverge.
      const day =
        this.instance_storage?.currentDay(new Date(time * 1000)) ?? date;

      await this.instance_storage?.insertLine(line, time, day);

      await this.instance_storage?.addToDates(day);
      await this.instance_storage?.addToDate(day);
      await this.instance_storage?.addDailyStats(day, {
        lines_read: lineSplitCount(line),
        chars_read: chars_in_line,
      });

      const event = new CustomEvent("new_line", {
        detail: {
          line_id: this.details!.last_line_added,
          line: line,
          time: time,
        },
      });
      document.dispatchEvent(event);
    }
  }

  async deleteLines(line_ids: number[]) {
    if (this.instance_storage === undefined) return;

    // Read each line's own stored bucket day and text straight from storage, so
    // the stats we subtract land in exactly the bucket the line contributed to —
    // regardless of any rollover-hour change since it was recorded.
    const date_stats: { [date: string]: Partial<Stat> } = {};

    for (const line_id of line_ids) {
      const key = JSON.stringify([this.uuid, line_id]);
      const entry = (await browser.storage.local.get(key))[key];
      if (entry === undefined) continue;

      const line: string = typeof entry === "string" ? entry : entry[0];
      const time: number | undefined =
        typeof entry === "string" ? undefined : entry[1];
      const day: string =
        Array.isArray(entry) && typeof entry[2] === "string"
          ? entry[2] // day stored at insert (authoritative)
          : time !== undefined && !isNaN(time)
            ? timeToDateString(time)! // legacy entry: its raw calendar day
            : this.instance_storage.currentDay();

      if (!date_stats[day]) {
        date_stats[day] = { lines_read: 0, chars_read: 0 };
      }
      date_stats[day].lines_read =
        (date_stats[day].lines_read ?? 0) + lineSplitCount(line);
      date_stats[day].chars_read =
        (date_stats[day].chars_read ?? 0) + charsInLine(line);
    }

    await this.instance_storage.deleteLines(line_ids);
    await this.instance_storage.subStats(date_stats);
  }

  async deleteLine(line_id: number, line: string, date: string) {
    await this.instance_storage?.deleteLine(line_id);
    await this.instance_storage?.subDailyStats(date, {
      lines_read: lineSplitCount(line),
      chars_read: charsInLine(line),
    });
  }
}
