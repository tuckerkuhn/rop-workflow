import { createHash } from "node:crypto";

/**
 * Where proof photos are kept (review round 1, Part 2 step 4). Postgres caps at 500 MB on the
 * database's free plan, about 1,000 photos, so photos can be moved to file storage, keeping only
 * each photo's fingerprint (SHA-256 of its bytes) in the record. Reading a photo back checks the
 * fingerprint again, so a file changed after it was saved shows as changed instead of passing.
 *
 * Which store is a deployment setting, `PROOF_FILE_STORE`:
 * - "inline" (the default): the picture stays inside the record, as before. Nothing changes until
 *   an administrator chooses otherwise.
 * - "supabase": Supabase Storage, part of the database service the app already uses (its free plan
 *   includes file storage), in a private bucket (`PROOF_FILE_BUCKET`, default "proof-files"). The
 *   bucket is made on first use. Uses NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * No new paid service either way.
 */

export type StoreMode = "inline" | "supabase";
export const storeMode = (): StoreMode => (process.env.PROOF_FILE_STORE === "supabase" ? "supabase" : "inline");
const bucket = () => process.env.PROOF_FILE_BUCKET || "proof-files";

/** A photo kept in file storage is written in a record as this reference, never as its bytes. */
export const FILE_REF = /^file:([0-9a-f]{64})$/;
export const fileRef = (sha256: string) => `file:${sha256}`;
export const refHash = (src: string) => FILE_REF.exec(src)?.[1] ?? null;

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
export const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("PROOF_FILE_STORE is supabase, but NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set.");
  return { url: url.replace(/\/$/, ""), headers: { Authorization: `Bearer ${key}`, apikey: key } };
}

/** Files are named by fingerprint, under the project: the same photo saved twice is one file. */
const pathOf = (project: string, hash: string) => `${encodeURIComponent(project)}/${hash}`;

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const { url, headers } = config();
  const res = await fetch(`${url}/storage/v1/bucket`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ id: bucket(), name: bucket(), public: false }) });
  // Made now, or there already: either way it is ready.
  if (!res.ok && res.status !== 409 && !/already exists/i.test(await res.text().catch(() => ""))) throw new Error(`The file store could not make its bucket (${res.status}).`);
  bucketReady = true;
}

/**
 * Keeps a photo the phone sent (a data URL). Returns what the record keeps: in "inline" mode the
 * picture itself, in "supabase" mode a reference to the stored file; and its fingerprint either way.
 */
export async function keepPhoto(project: string, src: string): Promise<{ src: string; sha256: string }> {
  const m = DATA_URL.exec(src);
  if (!m) throw new Error("Not a photo the app can keep.");
  const bytes = Buffer.from(m[2], "base64");
  const hash = sha256(bytes);
  if (storeMode() === "inline") return { src, sha256: hash };
  await ensureBucket();
  const { url, headers } = config();
  const res = await fetch(`${url}/storage/v1/object/${bucket()}/${pathOf(project, hash)}`, { method: "POST", headers: { ...headers, "Content-Type": m[1], "x-upsert": "false" }, body: new Uint8Array(bytes) });
  // Already there (the same photo sent twice): the stored copy is the same bytes, by its name.
  if (!res.ok && res.status !== 409 && !/exists/i.test(await res.text().catch(() => ""))) throw new Error(`The photo could not be stored (${res.status}). Try again.`);
  return { src: fileRef(hash), sha256: hash };
}

export type Fetched = { bytes: Buffer; type: string; intact: boolean };

/**
 * A stored photo's bytes, with whether they still match the fingerprint the record keeps. Null when
 * the file is missing.
 */
export async function fetchPhoto(project: string, hash: string): Promise<Fetched | null> {
  const { url, headers } = config();
  const res = await fetch(`${url}/storage/v1/object/${bucket()}/${pathOf(project, hash)}`, { headers });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`The photo could not be read from the file store (${res.status}).`);
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, type: res.headers.get("content-type") ?? "image/jpeg", intact: sha256(bytes) === hash };
}
