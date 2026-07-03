import "isomorphic-fetch";
import { Client } from "@microsoft/microsoft-graph-client";
import { auth, UPSTREAM_TENANT_ID } from "@/auth";

export type GraphFolder = { id: string; name: string };

/**
 * A Microsoft Graph client authenticated as the currently signed-in user,
 * using the access token surfaced on their NextAuth session.
 * Server-only — relies on `auth()` reading the session cookie.
 */
export async function getGraphClient(): Promise<Client> {
  const session = await auth();
  const accessToken = session?.accessToken;
  if (!accessToken) {
    throw new Error(
      "No Microsoft Graph access token on the session. Sign in again.",
    );
  }
  return Client.init({
    authProvider: (done) => done(null, accessToken),
  });
}

/**
 * The Graph access token from the current session. `auth()` runs the jwt
 * callback, which refreshes the token if it's expired — so callers always get a
 * usable token transparently.
 */
async function getAccessToken(): Promise<string> {
  const session = await auth();
  const accessToken = session?.accessToken;
  if (!accessToken) {
    throw new Error("No Microsoft Graph access token on the session.");
  }
  return accessToken;
}

let appOnlyTokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Client-credentials (app-only) Graph token — no user session involved.
 * Used by the /review/[token] routes, which have no signed-in reviewer to
 * draw a delegated token from. Requires the Entra app registration to have
 * been granted the Application permission Files.ReadWrite.All with admin
 * consent (separate from the Delegated permissions used for sign-in) —
 * without that grant, every app-only Graph call below will 403.
 * Cached in-memory until ~60s before expiry; the cache only helps within a
 * single warm process, so on serverless this is effectively "one token
 * fetch per cold start," which is harmless.
 */
async function getAppOnlyAccessToken(): Promise<string> {
  if (appOnlyTokenCache && Date.now() < appOnlyTokenCache.expiresAt - 60_000) {
    return appOnlyTokenCache.token;
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${UPSTREAM_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AUTH_MICROSOFT_ENTRA_ID_ID!,
        client_secret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      }),
    },
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      data?.error_description ?? "App-only Graph authentication failed.",
    );
  }

  appOnlyTokenCache = {
    token: data.access_token as string,
    expiresAt: Date.now() + Number(data.expires_in) * 1000,
  };
  return appOnlyTokenCache.token;
}

/**
 * A Microsoft Graph client authenticated app-only (client credentials), for
 * server code with no user session — e.g. the reviewer magic-link routes.
 */
export async function getAppOnlyGraphClient(): Promise<Client> {
  const accessToken = await getAppOnlyAccessToken();
  return Client.init({
    authProvider: (done) => done(null, accessToken),
  });
}

/** Upload a small (<4MB) file into a folder via a simple Graph PUT. Raw fetch
 * is the most reliable path for binary bodies. Returns the created drive
 * item's id, name and webUrl. */
async function uploadFileToFolderWithToken(
  accessToken: string,
  driveId: string,
  folderId: string,
  filename: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<{ id: string; name: string; webUrl: string }> {
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodeURIComponent(
    filename,
  )}:/content`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": contentType,
    },
    body: body as BodyInit,
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message ?? `OneDrive upload failed (${res.status}).`;
    if (res.status === 423 || /lock/i.test(msg)) {
      throw new Error(
        "The report file is open right now (in Word or OneDrive), so it can’t be overwritten. Close it everywhere, then regenerate.",
      );
    }
    throw new Error(msg);
  }
  return {
    id: data.id as string,
    name: data.name as string,
    webUrl: data.webUrl as string,
  };
}

export async function uploadFileToFolder(
  driveId: string,
  folderId: string,
  filename: string,
  body: Buffer | Uint8Array,
  contentType = "application/octet-stream",
): Promise<{ id: string; name: string; webUrl: string }> {
  return uploadFileToFolderWithToken(
    await getAccessToken(),
    driveId,
    folderId,
    filename,
    body,
    contentType,
  );
}

/** Same as {@link uploadFileToFolder}, but using the app-only Graph client
 * for callers with no user session (the reviewer magic-link routes). */
export async function uploadFileToFolderAppOnly(
  driveId: string,
  folderId: string,
  filename: string,
  body: Buffer | Uint8Array,
  contentType = "application/octet-stream",
): Promise<{ id: string; name: string; webUrl: string }> {
  return uploadFileToFolderWithToken(
    await getAppOnlyAccessToken(),
    driveId,
    folderId,
    filename,
    body,
    contentType,
  );
}

async function downloadDriveItemWithToken(
  accessToken: string,
  driveId: string,
  fileId: string,
): Promise<Buffer> {
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${fileId}/content`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.error?.message ?? "";
    } catch {
      /* binary/empty body */
    }
    throw new Error(
      `Download failed (${res.status})${detail ? `: ${detail}` : ""}.`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Download a drive item's raw bytes (GET /content). */
export async function downloadDriveItem(
  driveId: string,
  fileId: string,
): Promise<Buffer> {
  return downloadDriveItemWithToken(await getAccessToken(), driveId, fileId);
}

/** Same as {@link downloadDriveItem}, but using the app-only Graph client
 * for callers with no user session (the reviewer magic-link routes). */
export async function downloadDriveItemAppOnly(
  driveId: string,
  fileId: string,
): Promise<Buffer> {
  return downloadDriveItemWithToken(
    await getAppOnlyAccessToken(),
    driveId,
    fileId,
  );
}

async function downloadDriveItemAsPdfWithToken(
  accessToken: string,
  driveId: string,
  fileId: string,
): Promise<Buffer> {
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${fileId}/content?format=pdf`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.error?.message ?? "";
    } catch {
      /* binary/empty body */
    }
    throw new Error(
      `PDF conversion failed (${res.status})${detail ? `: ${detail}` : ""}.`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Download a drive item converted to PDF. OneDrive/SharePoint render the file
 * server-side (`?format=pdf`), so a generated `.docx` becomes a PDF without any
 * local conversion tooling.
 */
export async function downloadDriveItemAsPdf(
  driveId: string,
  fileId: string,
): Promise<Buffer> {
  return downloadDriveItemAsPdfWithToken(
    await getAccessToken(),
    driveId,
    fileId,
  );
}

/** Same as {@link downloadDriveItemAsPdf}, but using the app-only Graph
 * client for callers with no user session (the reviewer magic-link routes). */
export async function downloadDriveItemAsPdfAppOnly(
  driveId: string,
  fileId: string,
): Promise<Buffer> {
  return downloadDriveItemAsPdfWithToken(
    await getAppOnlyAccessToken(),
    driveId,
    fileId,
  );
}

/** The OneDrive web URL for a drive item, or null if it can't be fetched. */
export async function getDriveItemWebUrl(
  driveId: string,
  fileId: string,
): Promise<string | null> {
  try {
    const accessToken = await getAccessToken();
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${fileId}?$select=webUrl`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data.webUrl as string) ?? null;
  } catch {
    return null;
  }
}

/** List the immediate subfolders of a folder (folders only, up to 200). */
export async function listSubfolders(
  driveId: string,
  folderId: string,
): Promise<GraphFolder[]> {
  const client = await getGraphClient();
  const res = await client
    .api(`/drives/${driveId}/items/${folderId}/children`)
    .select("id,name,folder")
    .top(200)
    .get();

  return (res.value as Array<{ id: string; name: string; folder?: unknown }>)
    .filter((item) => item.folder != null)
    .map((item) => ({ id: item.id, name: item.name }));
}

/**
 * Find a subfolder by name (case-insensitive) under `parentId`, creating it if
 * it doesn't exist. Idempotent — safe to call repeatedly.
 */
export async function findOrCreateSubfolder(
  driveId: string,
  parentId: string,
  name: string,
): Promise<GraphFolder> {
  const client = await getGraphClient();

  const children = await client
    .api(`/drives/${driveId}/items/${parentId}/children`)
    .select("id,name,folder")
    .top(200)
    .get();

  const existing = (
    children.value as Array<{ id: string; name: string; folder?: unknown }>
  ).find(
    (item) => item.folder != null && item.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) return { id: existing.id, name: existing.name };

  const created = await client
    .api(`/drives/${driveId}/items/${parentId}/children`)
    .post({
      name,
      folder: {},
      "@microsoft.graph.conflictBehavior": "fail",
    });

  return { id: created.id, name: created.name };
}
