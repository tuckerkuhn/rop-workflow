import { asc, desc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { fold } from "@/lib/hr";
import { hrBook, todayIso } from "@/server/hr-store";

/**
 * One source for who reports to whom.
 *
 * It was kept twice: "Reports to" on the staff list (Settings, People) and "Supervisor" on the HR
 * record. Approvals read the first; leave, expenses and onboarding read the second. A supervisor
 * changed in HR and not in Settings sent approvals to the wrong person.
 *
 * The rule now: the HR record is the source. Whoever has a supervisor there reports to that
 * person everywhere in the app. The staff list's own "Reports to" is used only for someone with
 * no HR record (a partner, a donor contact, a person not yet hired in HR).
 */

let memo: { book: string; n: number; line: Record<string, string> } | null = null;

/** Person id to supervisor id, from the HR record as it stands today. Empty when there is no HR record yet. */
export async function supervisorsNow(): Promise<Record<string, string>> {
  const book = hrBook();
  try {
    const [last] = await db.select({ n: s.hrLedger.n }).from(s.hrLedger).where(eq(s.hrLedger.book, book)).orderBy(desc(s.hrLedger.n)).limit(1);
    if (!last) return {};
    if (memo && memo.book === book && memo.n === last.n) return memo.line;
    const rows = await db.select().from(s.hrLedger).where(eq(s.hrLedger.book, book)).orderBy(asc(s.hrLedger.n));
    const state = fold(
      rows.map((r) => ({ n: r.n, at: r.at.toISOString(), actor: r.actor, kind: r.kind, subject: r.subject, data: r.data, hash: r.hash, prevHash: r.prevHash })) as Parameters<typeof fold>[0],
      todayIso(),
    );
    const line = Object.fromEntries(Object.entries(state.people).flatMap(([id, p]) => (typeof p.current.supervisor === "string" && p.current.supervisor ? [[id, p.current.supervisor]] : [])));
    memo = { book, n: last.n, line };
    return line;
  } catch {
    // The reporting line must never take the app down: without the HR record, the staff list stands.
    return {};
  }
}

/** The same people, each reporting to their HR supervisor when they have one. */
export async function withReportingLine<P extends Pick<AppUser, "id" | "reportsTo">>(people: P[]): Promise<P[]> {
  const line = await supervisorsNow();
  return people.map((p) => (line[p.id] && line[p.id] !== p.reportsTo ? { ...p, reportsTo: line[p.id] } : p));
}
