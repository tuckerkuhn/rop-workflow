/**
 * Starts a read now and lets the caller await it later, where its result is used. Reads that do
 * not depend on each other then run together instead of one after another: each is a round trip
 * to the database, and a screen like Home makes dozens.
 *
 * Only for reads. A failure still surfaces at the await; the catch here only keeps Node from
 * reporting it a second time when an earlier step fails first and the await is never reached.
 */
export function early<T>(read: PromiseLike<T>): Promise<T> {
  const started = Promise.resolve(read);
  started.catch(() => undefined);
  return started;
}
