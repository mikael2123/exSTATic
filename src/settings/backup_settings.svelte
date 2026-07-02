<script lang="ts">
  import * as browser from "webextension-polyfill";
  import { onMount } from "svelte";

  let clientId = $state("");
  let clientSecret = $state("");
  let redirectUri = $state("");
  let connected = $state(false);
  let lastRun = $state<string | null>(null);
  let alertMsg = $state<string | null>(null);
  let busy = $state(false);
  let message = $state("");

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
