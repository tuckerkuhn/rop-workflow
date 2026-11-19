/**
 * The time each history entry was saved, set by the server so a phone's clock never decides it: the
 * date alone cannot show which of two same-day steps came first (an order and its delivery, an
 * approval and a payment). Entries saved before this keep their date only.
 */
export type Stamped = { date: string; what: string; at?: string };

// Compared field by field in a fixed order: the database hands objects back with their keys reordered.
const bare = <T extends { at?: string }>(e: T) => {
  const { at: _at, ...rest } = e as Record<string, unknown>;
  void _at;
  return JSON.stringify(Object.keys(rest).sort().map((k) => [k, rest[k]]));
};

/** Two histories match, the save times aside (a screen's copy does not carry them). */
export const sameHistory = <T extends { at?: string }>(a: T[], b: T[]) => a.length === b.length && a.every((e, i) => bare(e) === bare(b[i]));

/**
 * The history to store: entries already saved keep their stored time; new ones (past the stored
 * length) get the time now. A time sent by the screen is never taken.
 */
export function stampHistory<T extends { at?: string }>(stored: T[] | undefined, sent: T[], now = new Date()): T[] {
  const old = stored ?? [];
  return sent.map((e, i) => {
    if (i < old.length) return bare(e) === bare(old[i]) ? old[i] : (({ at: _a, ...rest }) => (void _a, rest as T))(e);
    const { at: _a, ...rest } = e;
    void _a;
    return { ...rest, at: now.toISOString() } as T;
  });
}

/** "09:42", in the viewer's time zone. */
export const timeOf = (at: string, locale?: string) => new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
