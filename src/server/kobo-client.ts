import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { KoboFormInfo, KoboQuestion } from "@/lib/kobo-setup";

/**
 * Calls to a project's KoboToolbox server (REST API v2). The server address comes from users,
 * so in production it must be https and must not point into a private network.
 */

export class KoboError extends Error {}

const dev = () => process.env.NODE_ENV !== "production";

function privateAddress(ip: string) {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase();
  return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80");
}

/** The cleaned server address, e.g. "https://kf.kobotoolbox.org". Throws KoboError when it is not allowed. */
export async function checkServerUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new KoboError("That is not a web address. It looks like https://kf.kobotoolbox.org");
  }
  if (url.username || url.password) throw new KoboError("Leave the user name and password out of the address; the API token signs in.");
  if (url.protocol !== "https:" && !(dev() && url.protocol === "http:")) throw new KoboError("The server address must start with https://");
  if (!dev()) {
    const addrs = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true }).catch(() => []);
    if (!addrs.length) throw new KoboError(`Could not find the server ${url.hostname}.`);
    if (addrs.some((a) => privateAddress(a.address))) throw new KoboError("That address points to a private network, which is not allowed.");
  }
  return url.origin;
}

async function get<T>(server: string, token: string, path: string): Promise<T> {
  let res: Response;
  try {
    // No redirects: a redirect could send the token, or the request, somewhere else.
    res = await fetch(`${server}${path}`, { headers: { Authorization: `Token ${token}`, Accept: "application/json" }, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20000) });
  } catch {
    throw new KoboError(`Could not reach ${server}. Check the address and try again.`);
  }
  if (res.status === 401 || res.status === 403) throw new KoboError("KoboToolbox did not accept the API token. Copy it again from Account settings > Security.");
  if (res.status === 404) throw new KoboError("KoboToolbox could not find that. Check the server address.");
  if (!res.ok) throw new KoboError(`KoboToolbox answered ${res.status}. Try again later.`);
  return (await res.json()) as T;
}

/** Same server, different page: Kobo's `next` links. Refuses links to any other host. */
const pathOf = (server: string, next: string) => {
  const u = new URL(next);
  if (u.origin !== server) throw new KoboError("KoboToolbox sent a link to another server; stopped.");
  return `${u.pathname}${u.search}`;
};

/** The account's survey forms. Also proves the address and token work. */
export async function listForms(server: string, token: string): Promise<KoboFormInfo[]> {
  const out: KoboFormInfo[] = [];
  let path: string | null = "/api/v2/assets/?format=json&asset_type=survey&limit=200";
  while (path) {
    const page: { results: { uid: string; name: string; deployment__active?: boolean; deployment__submission_count?: number }[]; next: string | null } = await get(server, token, path);
    out.push(...page.results.map((a) => ({ uid: a.uid, name: a.name || a.uid, deployed: !!a.deployment__active, submissions: a.deployment__submission_count ?? 0 })));
    path = page.next ? pathOf(server, page.next) : null;
  }
  return out;
}

type SurveyRow = { type: string; name?: string; $xpath?: string; label?: string[] | string; select_from_list_name?: string };
type Choice = { list_name: string; name: string; label?: string[] | string };

const SKIP = new Set(["begin_group", "end_group", "begin_repeat", "end_repeat", "note", "start", "end", "today", "deviceid", "username", "calculate", "hidden"]);
const firstLabel = (l: string[] | string | undefined, fallback: string) => (Array.isArray(l) ? l.find(Boolean) : l) || fallback;

/** The questions on a form, with choices for select questions. Groups, notes and metadata are left out. */
export async function formQuestions(server: string, token: string, uid: string): Promise<KoboQuestion[]> {
  const asset = await get<{ content?: { survey?: SurveyRow[]; choices?: Choice[] } }>(server, token, `/api/v2/assets/${encodeURIComponent(uid)}/?format=json`);
  const choices = asset.content?.choices ?? [];
  return (asset.content?.survey ?? [])
    .filter((r) => r.name && !SKIP.has(r.type.split(" ")[0]))
    .map((r) => {
      const list = r.select_from_list_name ?? (r.type.startsWith("select_") ? r.type.split(" ")[1] : undefined);
      return {
        path: r.$xpath ?? r.name!,
        label: firstLabel(r.label, r.name!),
        type: r.type.split(" ")[0],
        choices: list ? choices.filter((c) => c.list_name === list).map((c) => ({ name: c.name, label: firstLabel(c.label, c.name) })) : [],
      };
    });
}

export type KoboSubmission = Record<string, unknown> & { _uuid?: string; _submission_time?: string; _validation_status?: { uid?: string } };

const dataPath = (uid: string, params: Record<string, unknown>) =>
  `/api/v2/assets/${encodeURIComponent(uid)}/data/?format=json&${Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(typeof v === "string" || typeof v === "number" ? String(v) : JSON.stringify(v))}`)
    .join("&")}`;

/** Submissions on a form, page by page. `query` is Kobo's filter, e.g. {"_id": {"$gt": 120}}. */
export async function formSubmissions(server: string, token: string, uid: string, query?: Record<string, unknown>) {
  return pages<KoboSubmission>(server, token, dataPath(uid, { limit: 1000, sort: { _id: 1 }, ...(query ? { query } : {}) }));
}

export type SubmissionRef = { _id: number; _uuid?: string; _validation_status?: { uid?: string } | Record<string, never>; project_code?: unknown };

/**
 * Every submission's number, ID, approval status and project code, without the answers. Small enough to read
 * in full on each sync, so edits, approvals and deletions made in KoboToolbox are all seen.
 */
export async function submissionRefs(server: string, token: string, uid: string) {
  return pages<SubmissionRef>(server, token, dataPath(uid, { limit: 5000, sort: { _id: 1 }, fields: ["_id", "_uuid", "_validation_status", "project_code"] }));
}

async function pages<T>(server: string, token: string, first: string) {
  const out: T[] = [];
  let path: string | null = first;
  while (path) {
    const page: { results: T[]; next: string | null } = await get(server, token, path);
    out.push(...page.results);
    path = page.next ? pathOf(server, page.next) : null;
  }
  return out;
}

/**
 * Downloads one photo attached to a submission, as bytes. The address must be on the project's own
 * KoboToolbox server; Kobo may then hand the file over from its storage (a redirect, on which the
 * token is not sent on). Files over `max` bytes are skipped (null).
 */
export async function attachmentBytes(server: string, token: string, url: string, max = 4_000_000): Promise<{ bytes: Buffer; type: string } | null> {
  const u = new URL(url, server);
  if (u.origin !== server) throw new KoboError("A photo's address is on another server; it was not downloaded.");
  let res: Response;
  try {
    res = await fetch(u, { headers: { Authorization: `Token ${token}` }, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(30000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > max) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > max) return null;
  return { bytes, type: (res.headers.get("content-type") ?? "").split(";")[0].trim() };
}
