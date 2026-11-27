/**
 * Why an error happened, for the administrators' health page (review round 1, ISS-09).
 *
 * The database driver wraps every failure in the same words ("Failed query: select ..."), which
 * say which read failed and never why. The reason is on the error's `cause`: a refused
 * connection, a timeout, a dropped connection. Without it nobody can tell an overloaded database
 * from a broken query. Pure.
 */

type WithCause = { cause?: unknown; code?: unknown; message?: unknown };

/** The chain of causes under an error, nearest first, as "CODE: message < CODE: message". Null when there is none. */
export function causeOf(e: unknown): string | null {
  const parts: string[] = [];
  let at = (e as WithCause | null)?.cause;
  for (let depth = 0; at && depth < 4; depth++) {
    const c = at as WithCause;
    const code = typeof c.code === "string" && c.code ? `${c.code}: ` : "";
    const message = typeof c.message === "string" ? c.message : String(at);
    const line = `${code}${message}`.replace(/\s+/g, " ").trim();
    if (line && !parts.includes(line)) parts.push(line);
    at = c.cause;
  }
  return parts.length ? parts.join(" < ").slice(0, 400) : null;
}

const KNOWN: [RegExp, string][] = [
  [/max clients|too many clients|too many connections|remaining connection slots|\b53300\b/i, "The database refused a new connection: every connection it allows was already in use."],
  [/password authentication|\b28P01\b/i, "The database did not accept the app's password."],
  [/ECONNREFUSED|ENOTFOUND|getaddrinfo/i, "The app could not reach the database at all."],
  [/CONNECT_TIMEOUT|ETIMEDOUT|timed? ?out/i, "The database did not answer in time."],
  [/CONNECTION_CLOSED|CONNECTION_ENDED|CONNECTION_DESTROYED|ECONNRESET|EPIPE|terminat/i, "The connection to the database dropped while the app was using it."],
];

/** A known cause in plain words, or null when it is not one of the connection faults listed here. */
export function plainCause(cause: string | null | undefined): string | null {
  if (!cause) return null;
  return KNOWN.find(([pattern]) => pattern.test(cause))?.[1] ?? null;
}
