<script lang="ts">
  import * as browser from "webextension-polyfill";
  import { onMount } from "svelte";
  import OperationModal from "../components/interface/operation_modal.svelte";
  import {
    backupBeforeImport,
    importLinesFromCsv,
    importStatsFromCsv,
  } from "../data_wrangling/import_flow";

  let clientId = $state("");
  let clientSecret = $state("");
  let redirectUri = $state("");
  let connected = $state(false);
  let lastRun = $state<string | null>(null);
  let alertMsg = $state<string | null>(null);
  let busy = $state(false);
  let message = $state("");

  // ---- Import from Drive: confirmation + progress modal ----
  let modalOpen = $state(false);
  let modalTitle = $state("");
  let modalNote = $state("");
  let modalProgress = $state<{ done: number; total: number } | null>(null);
  let modalProceed = $state<(() => void) | undefined>(undefined);
  let modalCancel = $state<(() => void) | undefined>(undefined);
  // Force ("replace all") state for the import confirmation popup.
  let modalForce = $state(false);
  let modalShowForce = $state(false);

  const closeModal = () => {
    modalOpen = false;
    modalNote = "";
    modalProgress = null;
    modalProceed = undefined;
    modalCancel = undefined;
    modalForce = false;
    modalShowForce = false;
  };

  const loadStatus = async () => {
    const cfg = await browser.storage.local.get([
      "gdrive_client_id",
      "gdrive_client_secret",
    ]);
    clientId = (cfg["gdrive_client_id"] as string) ?? "";
    clientSecret = (cfg["gdrive_client_secret"] as string) ?? "";

    const status: any = await browser.runtime.sendMessage({
      action: "drive_status",
    });
    connected = status.connected;
    redirectUri = status.redirectUri;
    lastRun = status.lastRun;
    alertMsg = status.alert;
  };

  const saveConfig = async () => {
    await browser.storage.local.set({
      gdrive_client_id: clientId.trim(),
      gdrive_client_secret: clientSecret.trim(),
    });
    message = "Saved client ID and secret.";
  };

  const connect = async () => {
    busy = true;
    message = "Opening Google sign-in…";
    await saveConfig();
    const res: any = await browser.runtime.sendMessage({
      action: "drive_connect",
    });
    busy = false;
    message = res.ok
      ? "Connected to Google Drive!"
      : `Could not connect: ${res.error}`;
    await loadStatus();
  };

  const backupNow = async () => {
    busy = true;
    message = "Backing up to Google Drive…";
    const res: any = await browser.runtime.sendMessage({ action: "backup_now" });
    busy = false;
    message = res.ok
      ? `Backup complete (stats: ${res.results.stats}, lines: ${res.results.lines}).`
      : `Backup failed: ${res.error}`;
    await loadStatus();
  };

  const importFromDrive = async () => {
    busy = true;
    message = "Checking Google Drive for the latest backup…";
    const res: any = await browser.runtime.sendMessage({
      action: "drive_fetch_latest",
    });
    busy = false;

    if (!res.ok) {
      message = `Could not fetch from Drive: ${res.error}`;
      return;
    }
    message = "";

    const statsCsv: string | undefined = res.statsCsv;
    const linesCsv: string | undefined = res.linesCsv;

    modalTitle = "Import from Drive";
    modalNote =
      "This imports the latest stats & lines backup found on Google Drive into your current data. A backup is made first.";
    modalProgress = null;
    modalForce = false;
    modalShowForce = true;
    modalProceed = async () => {
      const force = modalForce;
      modalProceed = undefined;
      modalCancel = undefined;
      modalShowForce = false;
      try {
        modalNote = "Backing up current data first…";
        await backupBeforeImport();

        if (statsCsv) {
          modalNote = force ? "Replacing stats…" : "Importing stats…";
          await importStatsFromCsv(statsCsv, force);
        }
        if (linesCsv) {
          modalNote = force ? "Replacing lines…" : "Importing lines…";
          modalProgress = { done: 0, total: 0 };
          await importLinesFromCsv(linesCsv, force, (done, total) => {
            modalProgress = { done, total };
          });
        }

        modalTitle = "Import complete";
        modalNote = "Done! Please refresh all exSTATic pages.";
        modalProgress = null;
        modalCancel = closeModal;
      } catch (e: any) {
        modalTitle = "Import failed";
        modalNote = `Something went wrong: ${e?.message ?? e}`;
        modalProgress = null;
        modalCancel = closeModal;
      }
    };
    modalCancel = closeModal;
    modalOpen = true;
  };

  const disconnect = async () => {
    await browser.runtime.sendMessage({ action: "drive_disconnect" });
    message = "Disconnected from Google Drive.";
    await loadStatus();
  };

  const dismissAlert = async () => {
    await browser.storage.local.remove("backup_alert");
    alertMsg = null;
  };

  const copyRedirect = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      message = "Redirect URI copied to clipboard.";
    } catch {
      message = "Copy failed — select the URI text manually.";
    }
  };

  onMount(loadStatus);
</script>

<div class="m-5 flex flex-col gap-3 bg-block p-5 text-icon">
  <h2 class="text-2xl font-semibold">Google Drive Backups</h2>

  {#if alertMsg}
    <div class="flex items-center justify-between gap-3 bg-amber-700 p-3 text-white">
      <span>⚠ {alertMsg}</span>
      <button class="bg-button px-3 py-1" onclick={dismissAlert}>Dismiss</button>
    </div>
  {/if}

  <label class="flex flex-col gap-1">
    <span>OAuth Client ID</span>
    <input class="bg-menu p-2 text-menu-text" bind:value={clientId} />
  </label>

  <label class="flex flex-col gap-1">
    <span>OAuth Client Secret</span>
    <input
      class="bg-menu p-2 text-menu-text"
      type="password"
      bind:value={clientSecret}
    />
  </label>

  <div class="flex flex-col gap-1">
    <span>Redirect URI — add this to your Google OAuth client:</span>
    <div class="flex items-center gap-2">
      <code class="grow break-all bg-menu p-2 text-menu-text">{redirectUri}</code>
      <button class="bg-button px-3 py-1" onclick={copyRedirect}>Copy</button>
    </div>
  </div>

  <div class="flex flex-wrap gap-2">
    <button class="bg-button px-3 py-2" onclick={saveConfig} disabled={busy}
      >Save</button
    >
    {#if connected}
      <button class="bg-button px-3 py-2" onclick={backupNow} disabled={busy}
        >Backup now</button
      >
      <button class="bg-button px-3 py-2" onclick={disconnect} disabled={busy}
        >Disconnect</button
      >
    {:else}
      <button class="bg-button px-3 py-2" onclick={connect} disabled={busy}
        >Connect Google Drive</button
      >
    {/if}
  </div>

  <p>
    Status:
    {#if connected}
      <span class="text-green-400">Connected ✓</span>
      {#if lastRun}
        &nbsp;— last backup {new Date(lastRun).toLocaleString()}
      {/if}
    {:else}
      Not connected
    {/if}
  </p>

  {#if message}<p class="italic">{message}</p>{/if}
</div>

{#if connected}
  <div class="m-5 flex flex-col gap-3 bg-block p-5 text-icon">
    <h2 class="text-2xl font-semibold">Import from Drive</h2>
    <p>
      Pulls the latest stats & lines backup from Google Drive and imports it
      into your current data. A backup is made first.
    </p>
    <div class="flex flex-wrap gap-2">
      <button
        class="bg-button px-3 py-2"
        onclick={importFromDrive}
        disabled={busy}>Import latest from Drive</button
      >
    </div>
  </div>
{/if}

<OperationModal
  open={modalOpen}
  title={modalTitle}
  note={modalNote}
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
        ⚠ Are you sure? This permanently deletes your current stats and lines
        before importing. A backup is still made first.
      </p>
    {/if}
  {/if}
</OperationModal>
