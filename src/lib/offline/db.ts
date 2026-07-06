/**
 * IndexedDB store for the offline capture queue. Photos are written here at
 * shutter time (blob included) and deleted only once OneDrive has confirmed
 * the upload AND nothing still references them; action-item saves are queued
 * the same way. localStorage is not an option — photo blobs are ~500KB each.
 *
 * Client-only. Every function throws if IndexedDB is unavailable (rare:
 * some private-browsing modes); callers fall back to direct upload.
 */

export type QueuedPhoto = {
  localUuid: string;
  inspectionId: string;
  /** Present while the upload is still owed; dropped once uploaded. */
  blob?: Blob;
  width: number;
  height: number;
  /** Real capture time — also the source of the deterministic filename. */
  takenAt: string;
  state: "queued" | "uploaded";
  /** OneDrive identity, known once state === "uploaded". */
  fileId?: string;
  filename?: string;
  attempts: number;
  /** Epoch ms before which the drainer should skip this record (backoff). */
  nextAttemptAt: number;
};

export type QueuedItemSave = {
  localUuid: string;
  inspectionId: string;
  area: string;
  comment: string;
  photos: { localUuid: string; width: number; height: number; takenAt: string }[];
  attempts: number;
  nextAttemptAt: number;
};

/** An incident-report narrative note awaiting sync (incident reports only). */
export type QueuedNoteSave = {
  localUuid: string;
  inspectionId: string;
  text: string;
  attempts: number;
  nextAttemptAt: number;
};

const DB_NAME = "upstream-offline";
// v2 adds the note-saves store for incident reports.
const DB_VERSION = 2;
const PHOTOS = "photos";
const ITEMS = "item-saves";
const NOTES = "note-saves";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PHOTOS)) {
        db.createObjectStore(PHOTOS, { keyPath: "localUuid" });
      }
      if (!db.objectStoreNames.contains(ITEMS)) {
        db.createObjectStore(ITEMS, { keyPath: "localUuid" });
      }
      if (!db.objectStoreNames.contains(NOTES)) {
        db.createObjectStore(NOTES, { keyPath: "localUuid" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // If another tab upgrades the schema, drop our handle so the next call
      // reopens instead of erroring forever.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("IndexedDB open failed"));
    };
  });
  return dbPromise;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

async function store(
  name: string,
  mode: IDBTransactionMode,
): Promise<IDBObjectStore> {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export async function putPhoto(record: QueuedPhoto): Promise<void> {
  await requestToPromise((await store(PHOTOS, "readwrite")).put(record));
}

export async function getPhoto(localUuid: string): Promise<QueuedPhoto | undefined> {
  return requestToPromise((await store(PHOTOS, "readonly")).get(localUuid));
}

export async function deletePhoto(localUuid: string): Promise<void> {
  await requestToPromise((await store(PHOTOS, "readwrite")).delete(localUuid));
}

export async function listPhotos(): Promise<QueuedPhoto[]> {
  return requestToPromise((await store(PHOTOS, "readonly")).getAll());
}

export async function putItemSave(record: QueuedItemSave): Promise<void> {
  await requestToPromise((await store(ITEMS, "readwrite")).put(record));
}

export async function deleteItemSave(localUuid: string): Promise<void> {
  await requestToPromise((await store(ITEMS, "readwrite")).delete(localUuid));
}

export async function listItemSaves(): Promise<QueuedItemSave[]> {
  return requestToPromise((await store(ITEMS, "readonly")).getAll());
}

export async function putNoteSave(record: QueuedNoteSave): Promise<void> {
  await requestToPromise((await store(NOTES, "readwrite")).put(record));
}

export async function deleteNoteSave(localUuid: string): Promise<void> {
  await requestToPromise((await store(NOTES, "readwrite")).delete(localUuid));
}

export async function listNoteSaves(): Promise<QueuedNoteSave[]> {
  return requestToPromise((await store(NOTES, "readonly")).getAll());
}

/** True if IndexedDB can actually be opened in this browsing context. */
export async function idbAvailable(): Promise<boolean> {
  try {
    await openDb();
    return true;
  } catch {
    return false;
  }
}
