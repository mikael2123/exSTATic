import * as browser from "webextension-polyfill";
import { timeNowSeconds } from "../calculations";
import { InstanceStorage, type InstanceDetails } from "./instance_storage";
import { TypeStorage, type TypeProperties } from "./type_storage";

const REFRESH_STATS_INTERVAL = 1000; // in milliseconds

// EXTENDED STORAGE SPEC
// {
//     "type": {
//         "previous_uuid",
//         ...
//     },
//     "uuid": {
//         "last_active_at": "secs",
//         ...
//     }
// }

export class MediaStorage<TDetails extends InstanceDetails = InstanceDetails> {
  type_storage: TypeStorage;
  instance_storage?: InstanceStorage<TDetails>;
  properties: TypeProperties;
  details?: TDetails;
  uuid?: string;
  previous_time?: number;

  // Seconds already written to time_read that are only provisionally real:
  // everything credited since the last line was captured. Keyed by immersion day
  // because a grace window can straddle the rollover hour. The window is handed
  // back if it ends in an AFK timeout, and kept if it ends in a line or in a
  // deliberate pause.
  #pending_afk_credit: { [day: string]: number } = {};
  // The last_active_at the ledger above is keyed to. Any other value means a line
  // arrived (InstanceStorage.insertLine) or the timer was resumed by hand
  // (toggleActive), either of which confirms every second credited so far.
  #credit_anchor?: number;

  constructor(
    type_storage: TypeStorage,
    instance_storage?: InstanceStorage<TDetails>,
    live_stat_update = false,
  ) {
    this.type_storage = type_storage;
    this.instance_storage = instance_storage;

    this.properties = this.type_storage.properties;

    this.details = instance_storage?.details;
    this.uuid = this.properties.previous_uuid;

    if (live_stat_update) {
      this.stop_ticker(false);
      setInterval(this.#ticker.bind(this), REFRESH_STATS_INTERVAL);
    }
  }

  static async buildMediaStorage(type: string) {
    const type_storage = await TypeStorage.buildTypeStorage(type);

    const instance_storage = type_storage.properties.previous_uuid
      ? await InstanceStorage.buildInstance(
          type_storage.properties.previous_uuid,
          type_storage.properties,
        )
      : undefined;

    return new MediaStorage(type_storage, instance_storage);
  }

  async changeInstance(uuid?: string, given_identifier?: string) {
    // Get a UUID if it hasn't been suplied
    // When both are supplied use the UUID
    const new_uuid =
      !uuid && given_identifier
        ? await this.type_storage.getMedia(given_identifier)
        : uuid;

    if (!new_uuid)
      throw new Error(
        "Neither a uuid nor given identifier was provided, the instance cannot be changed",
      );

    // Nothing required if they're both the same
    if (this.uuid == new_uuid) {
      return;
    }

    // Ensure the previous UUID is correctly set
    if (this.properties["previous_uuid"] != new_uuid) {
      this.type_storage.updateProperties({ previous_uuid: new_uuid });
    }

    // Replace the storage entry
    const instance_storage = await InstanceStorage.buildInstance(
      new_uuid,
      this.type_storage.properties,
    );
    this.instance_storage = instance_storage;

    // Set the easy-access properties
    this.uuid = this.instance_storage.uuid;
    this.details = instance_storage.details;

    // The pending seconds were credited against the media being swapped out and
    // cannot be refunded against this one. A switch only happens because a line
    // arrived, which confirms them anyway.
    this.#confirmPendingCredit();

    // Dispatch an event
    await this.logLines();
  }

  async logLines() {
    const event = new CustomEvent("media_changed", {
      detail: {
        uuid: this.uuid,
        name: this.details!.name,
      },
    });
    document.dispatchEvent(event);
  }

  start_ticker(event = true) {
    if (this.previous_time == undefined) {
      this.previous_time = timeNowSeconds();
    }

    if (event) {
      const event = new Event("status_active");
      document.dispatchEvent(event);
    }
  }

  stop_ticker(event = true) {
    this.previous_time = undefined;
    // A deliberate stop — the pause button, a double-click, the capture toggle —
    // asserts that the time up to this instant was real reading, so the pending
    // seconds are confirmed rather than handed back. The AFK path refunds first
    // and then calls this, so nothing is lost here.
    this.#confirmPendingCredit();

    if (event) {
      const event = new Event("status_inactive");
      document.dispatchEvent(event);
    }
  }

  // Forget the pending seconds without handing them back: they count as real
  // reading. Every path except the AFK timeout ends here.
  #confirmPendingCredit() {
    this.#pending_afk_credit = {};
    this.#credit_anchor = undefined;
  }

  // Hand back every second credited since the last line. previous_time is
  // dropped and the ledger snapshotted-and-cleared up front, both synchronously,
  // so an overlapping ticker invocation can neither bank another second while
  // these writes are in flight nor refund the same seconds twice.
  async #refundAfkCredit() {
    const refunds = this.#pending_afk_credit;
    this.previous_time = undefined;
    this.#confirmPendingCredit();

    if (this.instance_storage == undefined) {
      return;
    }

    for (const [day, seconds] of Object.entries(refunds)) {
      // A non-finite entry means time_read is already poisoned upstream;
      // subtracting it would only spread the damage to other days.
      if (seconds === 0 || !Number.isFinite(seconds)) continue;

      await this.instance_storage.subDailyStats(day, { time_read: seconds });
    }
  }

  async #ticker() {
    const time_now = timeNowSeconds();

    if (this.instance_storage == undefined || this.previous_time == undefined) {
      return;
    }

    const last_active_at = this.details?.last_active_at;
    const time_between_lines = last_active_at ? time_now - last_active_at : 0;
    const time_between_ticks = time_now - this.previous_time;

    this.previous_time = time_now;

    // Every mutation of the ledger happens in this synchronous prefix, ahead of
    // the first await. The interval is a bare setInterval and a tick can outlast
    // its slot, so invocations do overlap; keeping the bookkeeping unyielding is
    // what stops one tick from re-filling a ledger another has just refunded.
    if (last_active_at !== this.#credit_anchor) {
      this.#pending_afk_credit = {};
      this.#credit_anchor = last_active_at;
    }

    // Keep incrementing the time read counter whilst the max afk time isn't exceeded
    if (time_between_lines <= this.properties.afk_max_time) {
      // One resolved day for both the credit and the ledger entry, so a tick
      // landing on the rollover instant cannot file them under different days.
      const day = this.instance_storage.currentDay();

      // Only the part of this tick that falls after the last line is provisional;
      // the rest was already confirmed by that line. Across a run of ticks this
      // telescopes to exactly (last tick - last_active_at), so the refund returns
      // the grace window to the second rather than approximately.
      this.#pending_afk_credit[day] =
        (this.#pending_afk_credit[day] ?? 0) +
        Math.min(time_between_ticks, Math.max(0, time_between_lines));

      await this.instance_storage.addDailyStats(day, {
        time_read: time_between_ticks,
      });
      this.start_ticker();
    } else {
      // Silence all the way to the timeout means none of the window was reading.
      // Refund before stop_ticker fires status_inactive, so the stat bar redraws
      // from the corrected total instead of the inflated one.
      await this.#refundAfkCredit();
      this.stop_ticker();
    }
  }

  async extensionActivated() {
    const listen_status = (await browser.storage.local.get("listen_status"))[
      "listen_status"
    ];
    return listen_status == true || listen_status === undefined;
  }

  // Start/stop the reading timer. Double-clicking the page, the AFK timeout and
  // the tracker's pause button all route through here, so there is exactly one
  // notion of "the timer is running". Separate from listen_status, which governs
  // whether lines are captured at all.
  async toggleActive() {
    const listen_status = await this.extensionActivated();
    if (!listen_status) {
      this.stop_ticker();
      return;
    }

    const time = timeNowSeconds();
    if (this.instance_storage === undefined) return;

    if (this.previous_time === undefined) {
      await this.instance_storage.updateDetails({ last_active_at: time });
      this.start_ticker();
    } else {
      this.stop_ticker();
    }
  }
}
