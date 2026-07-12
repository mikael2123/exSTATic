<script lang="ts">
  import * as browser from "webextension-polyfill";
  import { onMount } from "svelte";
  import OperationModal from "../components/interface/operation_modal.svelte";
  import {
    exportSettings,
    parseSettingsFile,
    diffSettings,
    applySettings,
    type SettingsPayload,
  } from "../data_wrangling/settings_io";

  let connected = $state(false);
  let busy = $state(false);
  let message = $state("");
  let fileInput: HTMLInputElement | undefined = $state();

  // Confirm / preview / result modal.
  let modalOpen = $state(false);
  let modalTitle = $state("");
  let modalNote = $state("");
  let modalIssues = $state<string[] | undefined>(undefined);
  let modalIssuesTitle = $state<string | undefined>(undefined);
  let modalIssuesEmpty = $state<string | undefined>(undefined);
  let modalProceed = $state<(() => void) | undefined>(undefined);
  let modalCancel = $state<(() => void) | undefined>(undefined);
  let modalCancelLabel = $state("Cancel");

  const closeModal = () => {
    modalOpen = false;
    modalNote = "";
    modalIssues = undefined;
    modalIssuesTitle = undefined;
    modalIssuesEmpty = undefined;
    modalProceed = undefined;
    modalCancel = undefined;
    modalCancelLabel = "Cancel";
  };

  const loadStatus = async () => {
    try {
      const status: any = await browser.runtime.sendMessage({
        action: "drive_status",
      });
      connected = !!status?.connected;
    } catch {
      connected = false;
    }
  };

  const doExport = async () => {
    busy = true;
    message = "Preparing settings export…";
    try {
      await exportSettings();
      message = "Exported your settings to exSTATic_settings.json.";
    } catch (e: any) {
      message = `Export failed: ${e?.message ?? e}`;
    }
    busy = false;
  };

  // Given a parsed payload + any parse notes, show the diff and apply on Proceed.
  const previewAndApply = async (
    payload: SettingsPayload,
    parseIssues: string[],
  ) => {
    const diff = await diffSettings(payload);

    modalTitle = "Import settings";
    modalNote = diff.hasChanges
      ? "Review the changes below. A backup of your current settings is made first."
      : "";
    modalIssues = [...parseIssues, ...diff.changes];
    modalIssuesTitle = "These settings will change:";
    modalIssuesEmpty = "No settings will change.";
    modalCancel = closeModal;
    modalCancelLabel = diff.hasChanges ? "Cancel" : "Close";

    modalProceed = diff.hasChanges
      ? async () => {
          modalProceed = undefined;
          modalCancel = undefined;
          modalIssues = undefined;
          modalIssuesTitle = undefined;
          modalIssuesEmpty = undefined;
          try {
            modalNote = "Backing up current settings first…";
            try {
              await browser.runtime.sendMessage({
                action: "backup_settings_now",
              });
            } catch {
              // Best-effort: a failed Drive snapshot shouldn't block the import.
            }
            modalNote = "Applying settings…";
            await applySettings(payload);
            modalTitle = "Settings imported";
            modalNote =
              "Done! Please refresh all exSTATic pages to see the changes.";
            modalCancel = closeModal;
            modalCancelLabel = "Close";
          } catch (e: any) {
            modalTitle = "Import failed";
            modalNote = `Something went wrong: ${e?.message ?? e}`;
            modalCancel = closeModal;
            modalCancelLabel = "Close";
          }
        }
      : undefined;
    modalOpen = true;
  };

  const onFileChosen = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // allow re-importing the same file
    if (!file) return;

    busy = true;
    message = "Reading settings file…";
    try {
      const text = await file.text();
      const { payload, issues } = parseSettingsFile(text);
      message = "";
      await previewAndApply(payload, issues);
    } catch (e: any) {
      message = `Could not read settings: ${e?.message ?? e}`;
    }
    busy = false;
  };

  const restoreFromDrive = async () => {
    busy = true;
    message = "Checking Google Drive for the latest settings backup…";
    try {
      const res: any = await browser.runtime.sendMessage({
        action: "drive_fetch_settings",
      });
      if (!res?.ok) {
        message = `Could not fetch from Drive: ${res?.error ?? "unknown error"}`;
        busy = false;
        return;
      }
      message = "";
      const { payload, issues } = parseSettingsFile(res.settingsJson);
      await previewAndApply(payload, issues);
    } catch (e: any) {
      message = `Could not fetch from Drive: ${e?.message ?? e}`;
    }
    busy = false;
  };

  onMount(loadStatus);
</script>

<div class="m-5 flex flex-col gap-3 bg-block p-5 text-icon">
  <h2 class="text-2xl font-semibold">Settings Backup</h2>
  <p>
    Export your settings to a file, or import one to review and apply its changes.
    Your Google Drive credentials are never included.
  </p>

  <div class="flex flex-wrap gap-2">
    <button class="bg-button px-3 py-2" onclick={doExport} disabled={busy}
      >Export settings</button
    >
    <button
      class="bg-button px-3 py-2"
      onclick={() => fileInput?.click()}
      disabled={busy}>Import settings</button
    >
    {#if connected}
      <button
        class="bg-button px-3 py-2"
        onclick={restoreFromDrive}
        disabled={busy}>Restore settings from Drive</button
      >
    {/if}
  </div>

  <input
    bind:this={fileInput}
    type="file"
    accept="application/json,.json"
    class="hidden"
    onchange={onFileChosen}
  />

  {#if message}<p class="italic">{message}</p>{/if}
</div>

<OperationModal
  open={modalOpen}
  title={modalTitle}
  note={modalNote}
  issues={modalIssues}
  issuesTitle={modalIssuesTitle}
  issuesEmpty={modalIssuesEmpty}
  onProceed={modalProceed}
  onCancel={modalCancel}
  cancelLabel={modalCancelLabel}
/>
