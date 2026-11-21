import { AsyncLocalStorage } from "node:async_hooks";

/**
 * One request's own short memory, for reads that many parts of the same answer repeat: which
 * project a code names, who reports to whom, the HR record. Home alone asks which project
 * "A-2027" is some thirty times, each a round trip to the database.
 *
 * It lives for one request and is thrown away with it, so nothing kept here can be stale for the
 * next request. It is switched on only once the request is known to be a read (GET): a request
 * that changes something reads the database every time, as before. Outside a route (scripts,
 * nightly jobs, tests) there is no memory at all.
 */
type Store = { reads: boolean; kept: Map<string, Promise<unknown>> };
const als = new AsyncLocalStorage<Store>();

/** Wraps a route (server/guard `handle`). The memory starts switched off. */
export const withRequestMemo = <T>(route: () => Promise<T>): Promise<T> => als.run({ reads: false, kept: new Map() }, route);

/** Called once the request is known only to read (server/auth `requireViewer`, for GET). */
export function requestOnlyReads() {
  const store = als.getStore();
  if (store) store.reads = true;
}

/**
 * Called by the few reads that write on the way (a distribution that has just arrived gets its
 * checks; the sample HR book fills itself on first use). Everything kept so far is dropped and
 * the memory stays off for the rest of the request, so nothing read after the write is older
 * than it.
 */
export function requestWrote() {
  const store = als.getStore();
  if (!store) return;
  store.reads = false;
  store.kept.clear();
}

/**
 * Reads once per read-only request for this key; anywhere else, every time. A failed read is not
 * kept. Each caller gets its own copy, so one part of the answer that sorts or fills in what it
 * was given cannot change what another part sees.
 */
export function oncePerRequest<T>(key: string, read: () => Promise<T>): Promise<T> {
  const store = als.getStore();
  if (!store?.reads) return read();
  let kept = store.kept.get(key) as Promise<T> | undefined;
  if (!kept) {
    kept = read();
    store.kept.set(key, kept);
    kept.catch(() => store.kept.delete(key));
  }
  return kept.then((v) => structuredClone(v));
}
