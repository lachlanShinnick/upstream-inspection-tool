import "isomorphic-fetch";
import { Client } from "@microsoft/microsoft-graph-client";
import { auth } from "@/auth";

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
 * Upload a small (<4MB) file into a folder via a simple Graph PUT, using the
 * session access token directly. Raw fetch is the most reliable path for binary
 * bodies. Returns the created drive item's id and name.
 */
export async function uploadFileToFolder(
  driveId: string,
  folderId: string,
  filename: string,
  body: Buffer | Uint8Array,
  contentType = "application/octet-stream",
): Promise<{ id: string; name: string }> {
  const session = await auth();
  const accessToken = session?.accessToken;
  if (!accessToken) {
    throw new Error("No Microsoft Graph access token on the session.");
  }

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
    throw new Error(
      data?.error?.message ?? `OneDrive upload failed (${res.status}).`,
    );
  }
  return { id: data.id as string, name: data.name as string };
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
