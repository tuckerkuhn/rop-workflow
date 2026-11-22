/**
 * Where an organization keeps its files, and so which links count as evidence. Proof is a link to
 * the file in the organization's own file store, never an upload of last resort. ROP's is
 * SharePoint; a local organization may use Google Drive, OneDrive or Dropbox. "Any secure link" is
 * allowed and discouraged: proof can then sit in one person's own account, where it can be changed
 * or lost and where an auditor cannot be given access. Set by an administrator in Organization
 * settings (server/org-settings-store `files`).
 */

export const STORES = [
  { id: "sharepoint", name: "SharePoint", test: /^https:\/\/[a-z0-9-]+\.sharepoint\.com\/\S+$/i },
  { id: "gdrive", name: "Google Drive", test: /^https:\/\/(drive|docs)\.google\.com\/\S+$/i },
  { id: "onedrive", name: "OneDrive", test: /^https:\/\/(onedrive\.live\.com|1drv\.ms)\/\S+$/i },
  { id: "dropbox", name: "Dropbox", test: /^https:\/\/(www\.)?dropbox\.com\/\S+$/i },
  { id: "any", name: "Any secure link", test: /^https:\/\/[^\s/]+\.[^\s/]+(\/\S*)?$/i },
] as const;
export type StoreId = (typeof STORES)[number]["id"];
export const STORE_IDS = STORES.map((s) => s.id) as [StoreId, ...StoreId[]];
export const DEFAULT_STORES: StoreId[] = ["sharepoint"];

/** What "any secure link" costs, said wherever it is chosen and wherever it is in force. */
export const ANY_LINK_RISK =
  "A link can then point to one person's own account. That person can change or delete the file, the link stops working when they leave, and an auditor cannot be given access to it. Proof that cannot be opened at audit counts as no proof.";

/** The stores in force. Empty or unknown input falls back to the default, so evidence is never left unchecked. */
export function cleanStores(input: unknown): StoreId[] {
  const ids = Array.isArray(input) ? STORE_IDS.filter((id) => input.includes(id)) : [];
  return ids.length ? ids : DEFAULT_STORES;
}

/**
 * The stores in force: `now`, where a new link may point; `ever`, every store the organization has
 * taken links from (the default before anything was set, and each later choice). Proof recorded
 * under an earlier setting stays proof, so changing the setting never undoes finished work.
 */
/** `accounting` and `payroll`: what the organization calls those systems, when it has said (Organization settings). */
export type StoreSet = { now: StoreId[]; ever: StoreId[]; accounting?: string; payroll?: string };
const NAMED: StoreId[] = STORE_IDS.filter((id) => id !== "any");
export function storeSet(now: unknown, earlier: unknown[] = []): StoreSet {
  const n = cleanStores(now);
  const all = new Set<StoreId>([...DEFAULT_STORES, ...n, ...earlier.flatMap((e) => (Array.isArray(e) ? cleanStores(e) : []))]);
  return { now: n, ever: STORE_IDS.filter((id) => all.has(id)) };
}
/** Outside any organization (scripts, nightly jobs): new links take the default, recorded proof any named store. */
export const NO_ORG: StoreSet = { now: DEFAULT_STORES, ever: NAMED };

// In the browser: the signed-in person's organization (set from the session). On the server: the
// organization of the request being answered (server/request-memo registers a per-request resolver).
let clientStores: StoreSet = storeSet(null);
let resolver: () => StoreSet = () => clientStores;
export const setClientStores = (s: StoreSet) => {
  clientStores = s;
};
export const setStoreResolver = (fn: () => StoreSet) => {
  resolver = fn;
};
export const currentStores = (): StoreId[] => resolver().now;
export const storesEver = (): StoreId[] => resolver().ever;

/** Whether a link points into one of the organization's file stores. */
export function isFileLink(url: string, stores: StoreId[] = currentStores()): boolean {
  const u = (url ?? "").trim();
  return STORES.some((s) => stores.includes(s.id) && s.test.test(u));
}

/** Whether recorded proof still counts: a link into any store the organization has ever used. */
export const isRecordedFileLink = (url: string, stores: StoreId[] = storesEver()) => isFileLink(url, stores);

/** The stores by name, for a sentence: "SharePoint", "Google Drive or Dropbox", "your file store". */
export function storeNames(stores: StoreId[] = currentStores()): string {
  if (stores.includes("any")) return "your file store";
  const names = STORES.filter((s) => stores.includes(s.id)).map((s) => s.name);
  return names.length <= 1 ? (names[0] ?? "SharePoint") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** The organization's accounting system by name, for a sentence: "NetSuite", or "your accounting system" until it is named. */
export const acct = (): string => resolver().accounting?.trim() || "your accounting system";
/** The organization's payroll system by name, or "your payroll system". */
export const payrollName = (): string => resolver().payroll?.trim() || "your payroll system";
/** Shown under a link box while "any secure link" is in force: the person pasting the link is the one who decides where proof sits. */
export const ANY_LINK_CAUTION = "Use a link to a folder the organization owns, not your own account. A file in a personal account can be lost when someone leaves, and proof that cannot be opened at audit counts as no proof.";
export const anyLinkOn = (): boolean => resolver().now.includes("any");
