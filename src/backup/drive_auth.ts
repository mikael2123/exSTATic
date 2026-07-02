import * as browser from "webextension-polyfill";

// Google OAuth for Google Drive backups. Runs in the background page only
// (content scripts cannot access browser.identity). Mirrors the ttu-reader
// model: a "Web application" OAuth client (client id + secret), authorization
// code + offline flow so we get a refresh token for long-lived, unattended
// backups. The user pastes their client id/secret into the settings page.

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

export function getRedirectUri(): string {
  return browser.identity.getRedirectURL();
}

async function getConfig(): Promise<{ clientId?: string; clientSecret?: string }> {
  const cfg = await browser.storage.local.get([
    "gdrive_client_id",
    "gdrive_client_secret",
  ]);
  return {
    clientId: cfg["gdrive_client_id"] as string | undefined,
    clientSecret: cfg["gdrive_client_secret"] as string | undefined,
  };
}

export async function isConnected(): Promise<boolean> {
  const { gdrive_refresh_token } = await browser.storage.local.get(
    "gdrive_refresh_token",
  );
  return !!gdrive_refresh_token;
}

export async function connectDrive(): Promise<{ ok: boolean; error?: string }> {
  const { clientId, clientSecret } = await getConfig();
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      error: "Set your Google OAuth Client ID and secret first.",
    };
  }

  const redirectUri = getRedirectUri();
  const authUrl =
    `${AUTH_ENDPOINT}?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(SCOPE)}` +
    `&access_type=offline&prompt=consent`;

  let redirectResponse: string;
  try {
    redirectResponse = await browser.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true,
    });
  } catch (e) {
    return { ok: false, error: "Authorization was cancelled or failed." };
  }

  const url = new URL(redirectResponse);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err || !code) {
    return { ok: false, error: err ?? "No authorization code returned." };
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const resp = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) {
    return { ok: false, error: `Token exchange failed (${resp.status}).` };
  }
  const tok = await resp.json();
  if (!tok.refresh_token) {
    return {
      ok: false,
      error:
        "No refresh token returned. Remove exSTATic's access under your Google account permissions, then reconnect.",
    };
  }

  await browser.storage.local.set({
    gdrive_refresh_token: tok.refresh_token,
    gdrive_access_token: tok.access_token,
    gdrive_token_expiry: Date.now() + (tok.expires_in ?? 3600) * 1000,
  });
  return { ok: true };
}

export async function getAccessToken(): Promise<string> {
  const stored = await browser.storage.local.get([
    "gdrive_access_token",
    "gdrive_token_expiry",
    "gdrive_refresh_token",
  ]);

  const now = Date.now();
  const expiry = stored["gdrive_token_expiry"] as number | undefined;
  if (stored["gdrive_access_token"] && expiry && now < expiry - 60000) {
    return stored["gdrive_access_token"] as string;
  }

  const refresh = stored["gdrive_refresh_token"] as string | undefined;
  if (!refresh) throw new Error("Google Drive not connected.");

  const { clientId, clientSecret } = await getConfig();
  if (!clientId || !clientSecret) {
    throw new Error("Missing Google OAuth client configuration.");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refresh,
    grant_type: "refresh_token",
  });
  const resp = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) {
    throw new Error(`Token refresh failed (${resp.status}). Reconnect Drive.`);
  }
  const tok = await resp.json();
  await browser.storage.local.set({
    gdrive_access_token: tok.access_token,
    gdrive_token_expiry: Date.now() + (tok.expires_in ?? 3600) * 1000,
  });
  return tok.access_token;
}

export async function disconnectDrive(): Promise<void> {
  await browser.storage.local.remove([
    "gdrive_refresh_token",
    "gdrive_access_token",
    "gdrive_token_expiry",
  ]);
}
