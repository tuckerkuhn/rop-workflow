"use client";

/**
 * The phone's outbox: weekly items and results saved without a connection wait here, photos
 * included, and are sent when the connection is back. Kept in this browser's IndexedDB only; the
 * server never sees anything until it is sent, and nothing else from the app is stored offline.
 *
 * A photo picked offline gets a stand-in fingerprint (64 hex characters, like a real one). When the
 * entry is sent, each photo is uploaded first and its real fingerprint replaces the stand-in
 * everywhere in the saved action (file list, captions, dates taken).
 */

export type OutboxEntry = { id: string; at: string; user: string; project: string; url: string; label: string; action: unknown; photos: { local: string; name: string; type: string; blob: Blob }[]; error?: string };

const DB = "rop-outbox";
const STORE = "entries";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const EVENT = "rop-outbox-changed";
const changed = () => window.dispatchEvent(new Event(EVENT));
export const onOutboxChange = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
};

/** A stand-in fingerprint for a photo picked without a connection. */
export const localHash = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");

/** Whether a failed request means "no connection" (try later) rather than a refusal. */
export const isOffline = (e: unknown) => !navigator.onLine || e instanceof TypeError;

export async function addToOutbox(e: Omit<OutboxEntry, "id" | "at">) {
  await tx("readwrite", (s) => s.put({ ...e, id: crypto.randomUUID(), at: new Date().toISOString() }));
  changed();
}
export async function outbox(user?: string): Promise<OutboxEntry[]> {
  const all = (await tx<OutboxEntry[]>("readonly", (s) => s.getAll())) ?? [];
  return all.filter((e) => !user || e.user === user).sort((a, b) => a.at.localeCompare(b.at));
}
export async function removeFromOutbox(id: string) {
  await tx("readwrite", (s) => s.delete(id));
  changed();
}

let sending = false;
/**
 * Sends what is waiting, oldest first. Stops at the first missing connection; an entry the server
 * refuses is kept with the reason, for the person to see and remove.
 */
export async function sendOutbox(user: string): Promise<{ sent: number; left: number }> {
  if (sending || !navigator.onLine) return { sent: 0, left: (await outbox(user)).length };
  sending = true;
  let sent = 0;
  try {
    for (const e of await outbox(user)) {
      if (e.error) continue;
      try {
        let json = JSON.stringify(e.action);
        for (const p of e.photos) {
          const body = new FormData();
          body.append("file", new File([p.blob], p.name, { type: p.type }));
          const r = await fetch("/api/files", { method: "POST", body, headers: { "x-demo-user": user } });
          if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({}))).error ?? `Photo refused (${r.status})`), { refused: true });
          const { hash } = (await r.json()) as { hash: string };
          json = json.split(p.local).join(hash);
        }
        const r = await fetch(e.url, { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": user }, body: json });
        if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({}))).error ?? `Refused (${r.status})`), { refused: true });
        await removeFromOutbox(e.id);
        sent++;
      } catch (err) {
        if ((err as { refused?: boolean }).refused) {
          await tx("readwrite", (s) => s.put({ ...e, error: err instanceof Error ? err.message : String(err) }));
          changed();
          continue;
        }
        break; // no connection: try again later
      }
    }
  } finally {
    sending = false;
  }
  return { sent, left: (await outbox(user)).length };
}
