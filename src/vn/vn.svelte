<script lang="ts">
  import * as browser from "webextension-polyfill";
  import type { VNStorage } from "./vn_storage";
  import { exportLines, exportStats } from "../data_wrangling/data_export";
  import { importLines, importStats } from "../data_wrangling/data_import";
  import { backupBeforeImport } from "../data_wrangling/import_flow";
  import StatBar from "../components/interface/stat_bar.svelte";
  import MenuBar from "../components/interface/menu_bar.svelte";
  import MenuOption from "../components/interface/menu_option.svelte";
  import LineHolder from "../components/interface/line_holder.svelte";
  import OperationModal from "../components/interface/operation_modal.svelte";
  import { AVAILABLE_FONTS } from "../font_list";
  import {
    validateStats,
    validateLines,
    type LineRow,
  } from "../data_wrangling/data_validation";

  import { parse } from "papaparse";
  import type { DataEntry } from "../data_wrangling/data_extraction";

  interface Props {
    vn_storage: VNStorage;
  }

  let { vn_storage }: Props = $props();
  let title = $state("Game");
  let lines: string[][] = $state([]);
  let menu = $state(false);

  // Events for media being added/replaced
  document.addEventListener("media_changed", (event: CustomEvent) => {
    // Show name and title
    title = event.detail["name"];

    // Show lines
    lines = event.detail["lines"].sort(
      (
        first: [string, number, string, number],
        second: [string, number, string, number],
      ) => first[1] - second[1],
    );
  });

  document.addEventListener("new_line", (event) =>
    lines.push([
      vn_storage.uuid,
      event["detail"]["line_id"],
      event["detail"]["line"],
      event["detail"]["time"],
    ]),
  );

  // UI events
  const setTitle = (title: string) => {
    if (vn_storage == undefined || vn_storage.instance_storage == undefined)
      return;
    document.title = title + " | exSTATic";
    vn_storage.instance_storage.updateDetails({ name: title });
  };
  $effect(() => {
    setTitle(title);
  });

  // ---- Import / export flow with a preview + progress modal ----
  let modalOpen = $state(false);
  let modalTitle = $state("");
  let modalNote = $state("");
  let modalIssues = $state<string[] | undefined>(undefined);
  let modalProgress = $state<{ done: number; total: number } | null>(null);
  let modalProceed = $state<(() => void) | undefined>(undefined);
  let modalCancel = $state<(() => void) | undefined>(undefined);
  // Force ("replace all") state for the import confirmation popup.
  let modalForce = $state(false);
  let modalShowForce = $state(false);

  const closeModal = () => {
    modalOpen = false;
    modalNote = "";
    modalIssues = undefined;
    modalProgress = null;
    modalProceed = undefined;
    modalCancel = undefined;
    modalForce = false;
    modalShowForce = false;
  };

  const readFile = (event: Event): File | undefined => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // allow re-selecting the same file later
    return file ?? undefined;
  };

  const runImportStats = (event: Event) => {
    const file = readFile(event);
    if (!file) return;

    parse(file, {
      header: true,
      dynamicTyping: true,
      complete: (result) => {
        const { cleaned, report } = validateStats(result.data as DataEntry[]);

        modalTitle = "Import Stats";
        modalNote =
          "This merges these stats into your current data. A backup is made first.";
        modalIssues = report.issues;
        modalProgress = null;
        modalForce = false;
        modalShowForce = true;
        modalProceed = async () => {
          const force = modalForce;
          modalProceed = undefined;
          modalCancel = undefined;
          modalIssues = undefined;
          modalShowForce = false;
          modalNote = "Backing up current data first…";
          await backupBeforeImport();
          modalNote = force ? "Replacing data…" : "Importing stats…";
          await importStats(cleaned, { force });
          modalTitle = "Import complete";
          modalNote = "Done! Please refresh all exSTATic pages.";
          modalCancel = closeModal;
        };
        modalCancel = closeModal;
        modalOpen = true;
      },
    });
  };

  const runImportLines = (event: Event) => {
    const file = readFile(event);
    if (!file) return;

    parse(file, {
      header: true,
      dynamicTyping: true,
      complete: (result) => {
        const { cleaned, report } = validateLines(result.data as LineRow[]);

        modalTitle = "Import Lines";
        modalNote =
          "This adds these lines to storage. A backup is made first.";
        modalIssues = report.issues;
        modalProgress = null;
        modalForce = false;
        modalShowForce = true;
        modalProceed = async () => {
          const force = modalForce;
          modalProceed = undefined;
          modalCancel = undefined;
          modalIssues = undefined;
          modalShowForce = false;
          modalNote = "Backing up current data first…";
          await backupBeforeImport();
          modalNote = force ? "Replacing lines…" : "Importing lines…";
          modalProgress = { done: 0, total: cleaned.length };
          await importLines(cleaned, { force }, (done, total) => {
            modalProgress = { done, total };
          });
          modalTitle = "Import complete";
          modalNote = "Done! Please refresh all exSTATic pages.";
          modalProgress = null;
          modalCancel = closeModal;
        };
        modalCancel = closeModal;
        modalOpen = true;
      },
    });
  };

  const runExportLines = async () => {
    modalTitle = "Export Lines";
    modalNote = "Building your lines file — this can take a while…";
    modalIssues = undefined;
    modalProceed = undefined;
    modalCancel = undefined;
    modalProgress = { done: 0, total: 0 };
    modalOpen = true;
    await exportLines((done, total) => {
      modalProgress = { done, total };
    });
    modalTitle = "Export complete";
    modalNote = "Your lines file has been downloaded.";
    modalProgress = null;
    modalCancel = closeModal;
  };

  const openStats = () => {
    browser.runtime.sendMessage({
      action: "open_tab",
      url: "https://kamwithk.github.io/exSTATic/stats.html",
    });
  };

  document.addEventListener("status_active", () => {
    document.documentElement.style.setProperty(
      "--default-inactivity-blur",
      "0",
    );
  });

  document.addEventListener("status_inactive", () => {
    document.documentElement.style.setProperty(
      "--default-inactivity-blur",
      vn_storage.properties["inactivity_blur"] + "px",
    );
  });

  const deleteLines = async () => {
    if (vn_storage.instance_storage === undefined) return;

    const checked_boxes = Array.from(
      document.querySelectorAll(".line-select:checked"),
    );

    if (checked_boxes.length === 0) return;

    const plural = checked_boxes.length > 1 ? "lines" : "line";

    const confirmed = confirm(
      `Are you sure you'd like to delete ${checked_boxes.length} ${plural}?\nChar and line statistics will be modified accordingly however time read won't change...`,
    );

    if (!confirmed) return;

    const parents = checked_boxes.map((checkbox) => checkbox.parentElement);
    const line_ids = parents.map((element_div) =>
      Number.parseInt(element_div?.dataset.lineId!),
    );

    await vn_storage.deleteLines(line_ids);
    parents.forEach((element_div) => element_div?.remove());
  };
</script>

<div
  id="top_bar"
  class="sticky top-0 z-50 flex h-20 items-center justify-between px-12"
>
  <input
    id="game_name"
    class="jp-text h-full w-20 shrink grow justify-self-start"
    type="text"
    bind:value={title}
  />
  <div class="relative">
    <StatBar media_storage={vn_storage}>
      <button
        class="material-icons rounded-full hover:bg-hover"
        onclick={() => (menu = !menu)}>more_vert</button
      >
    </StatBar>
    <MenuBar show={menu} media_storage={vn_storage}>
      <MenuOption
        media_storage={vn_storage}
        id="font"
        description="Font"
        options={AVAILABLE_FONTS}
        value="Klee One"
        root_css="--default-font"
      />
      <MenuOption
        media_storage={vn_storage}
        id="font_size"
        description="Font Size"
        units="rem"
        value="2"
        root_css="--default-font-size"
      />
      <MenuOption
        media_storage={vn_storage}
        id="bottom_line_padding"
        description="Bottom Pushback"
        units="%"
        value="20"
        root_css="--default-text-align"
      />
      <MenuOption
        media_storage={vn_storage}
        id="afk_max_time"
        description="Max AFK Time"
        units="secs"
        value="60"
      />
      <MenuOption
        media_storage={vn_storage}
        id="max_loaded_lines"
        description="Max Loaded Lines"
        units="UI"
        value="5000"
      />
      <MenuOption
        media_storage={vn_storage}
        id="inactivity_blur"
        description="Inactivity Blur"
        units="px"
        value="2"
      />
      <MenuOption
        media_storage={vn_storage}
        id="menu_blur"
        description="Menu Blur"
        units="px"
        value="8"
        root_css="--default-menu-blur"
      />

      <button
        id="settings_page"
        class="menu-button"
        onclick={() =>
          window.open("https://kamwithk.github.io/exSTATic/settings.html")}
      >
        Settings
      </button>
      <button id="export_stats" class="menu-button" onclick={exportStats}
        >Export Stats</button
      >
      <button id="export_lines" class="menu-button" onclick={runExportLines}
        >Export Lines</button
      >
      <button
        class="menu-button"
        onclick={() => document.getElementById("import_stats")?.click()}
      >
        Import Stats
        <input
          id="import_stats"
          class="hidden"
          type="file"
          onchange={(e) => runImportStats(e)}
        />
      </button>
      <button
        class="menu-button"
        onclick={() => document.getElementById("import_lines")?.click()}
      >
        Import Lines
        <input
          id="import_lines"
          class="hidden"
          type="file"
          onchange={(e) => runImportLines(e)}
        />
      </button>
      <button id="view_stats" class="menu-button" onclick={openStats}
        >View Stats</button
      >
    </MenuBar>
  </div>
  <button
    id="delete-selection"
    class="material-icons delete-button"
    onclick={deleteLines}>delete</button
  >
</div>

<div
  class="px-12"
  role="feed"
  ondblclick={vn_storage.toggleActive.bind(vn_storage)}
>
  <LineHolder
    bind:lines
    onclick={() => (menu = false)}
    on:dblclick
    {ondblclick}
  />
</div>

<OperationModal
  open={modalOpen}
  title={modalTitle}
  note={modalNote}
  issues={modalIssues}
  progress={modalProgress}
  onProceed={modalProceed}
  onCancel={modalCancel}
  proceedLabel={modalForce ? "Replace all" : "Proceed"}
>
  {#if modalShowForce}
    <label class="flex items-center gap-2">
      <input type="checkbox" bind:checked={modalForce} />
      Replace all (force) — wipe current data first
    </label>
    {#if modalForce}
      <p class="bg-amber-700 p-2 text-sm text-white">
        ⚠ Are you sure? This permanently deletes your current
        {modalTitle.includes("Lines") ? "lines" : "stats"} before importing. A
        backup is still made first.
      </p>
    {/if}
  {/if}
</OperationModal>

<style global lang="postcss">
  @tailwind base;
  @tailwind components;
  @tailwind utilities;

  input {
    border-style: none;
  }

  body {
    @apply bg-backdrop;
  }

  .jp-text {
    font-family: var(--default-font);
    font-size: var(--default-font-size);
  }

  #top_bar {
    @apply bg-backdrop py-3;
  }

  #game_name {
    @apply bg-transparent text-4xl text-title;
  }

  .entry_holder {
    @apply bg-backdrop;
  }

  .sentence-entry {
    @apply jp-text flex items-center gap-4 bg-block p-4;
    filter: blur(var(--default-inactivity-blur));
  }

  .sentence {
    @apply jp-text inline-block grow text-left text-text;
  }

  .delete-button {
    @apply inline-flex self-center rounded-full border-indigo-500 p-2 text-button-text hover:bg-hover hover:text-icon;
  }

  .line-select {
    @apply h-4 w-4 shrink-0 rounded-full bg-button text-button-text;
  }

  .stat-numbers {
    @apply whitespace-nowrap font-mono text-base;
  }

  .stat-annotation {
    @apply whitespace-nowrap text-xs tracking-tighter;
  }

  .menu-bar {
    @apply flex h-full items-center gap-3 bg-button bg-opacity-70 p-3 hover:bg-opacity-80 hover:filter-none;
    filter: blur(var(--default-menu-blur));
  }

  .menu-button {
    @apply col-span-2 bg-block p-4 text-left text-icon hover:bg-hover;
  }

  .menu-input {
    @apply col-start-2 grow bg-menu p-1 text-menu-text;
  }

  .menu-label {
    @apply bg-block p-4 text-icon;
  }
</style>
