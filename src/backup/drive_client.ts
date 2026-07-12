import { getAccessToken } from "./drive_auth";

// Minimal Google Drive REST helpers using the drive.file scope (the app can
// only see/manage files it created). Runs in the background page.

const FILES = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_NAME = "exSTATic_backups";

async function authHeader(): Promise<{ Authorization: string }> {
  const token = await getAccessToken();
  return { Authorization: `Bearer ${token}` };
}

export async function ensureFolder(): Promise<string> {
  const headers = await authHeader();
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const res = await fetch(`${FILES}?q=${q}&spaces=drive&fields=files(id,name)`, {
    headers,
  });
  if (!res.ok) throw new Error(`Drive folder lookup failed (${res.status}).`);
  const data = await res.json();
  if (data.files && data.files.length > 0) return data.files[0].id;

  const createRes = await fetch(`${FILES}?fields=id`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Drive folder create failed (${createRes.status}).`);
  }
  return (await createRes.json()).id;
}

export async function createFile(
  folderId: string,
  name: string,
  content: string,
): Promise<string> {
  const headers = await authHeader();
  const boundary = "exstatic_" + Math.random().toString(36).slice(2);
  const metadata = { name, parents: [folderId] };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    `Content-Type: text/csv; charset=UTF-8\r\n\r\n` +
    content +
    `\r\n--${boundary}--`;

  const res = await fetch(`${UPLOAD}?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Drive upload failed (${res.status}).`);
  return (await res.json()).id;
}

export async function updateFileContent(
  fileId: string,
  content: string,
): Promise<void> {
  const headers = await authHeader();
  const res = await fetch(`${UPLOAD}/${fileId}?uploadType=media`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "text/csv; charset=UTF-8" },
    body: content,
  });
  if (!res.ok) throw new Error(`Drive content update failed (${res.status}).`);
}

export async function renameFile(
  fileId: string,
  newName: string,
): Promise<void> {
  const headers = await authHeader();
  const res = await fetch(`${FILES}/${fileId}?fields=id`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: newName }),
  });
  if (!res.ok) throw new Error(`Drive rename failed (${res.status}).`);
}

export async function downloadFileText(fileId: string): Promise<string> {
  const headers = await authHeader();
  const res = await fetch(`${FILES}/${fileId}?alt=media`, { headers });
  if (!res.ok) throw new Error(`Drive download failed (${res.status}).`);
  return await res.text();
}

export async function listFiles(
  folderId: string,
): Promise<{ id: string; name: string; modifiedTime: string }[]> {
  const headers = await authHeader();
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const res = await fetch(
    `${FILES}?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`,
    { headers },
  );
  if (!res.ok) throw new Error(`Drive file listing failed (${res.status}).`);
  const data = await res.json();
  return data.files ?? [];
}
