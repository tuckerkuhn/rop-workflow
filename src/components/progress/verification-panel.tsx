"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";
import { plainError } from "@/lib/plain-error";

type Visit = { farmer: string; collectorName: string | null; assigneeName: string | null; mine: boolean; done?: { byName: string; at: string; result: "confirmed" | "discrepancy"; note: string } };
type View = { month: string; drawn: boolean; may: { draw: boolean }; rate: number; months: { month: string; rate: number; done: number; visits: Visit[] }[] };

/**
 * MF-10: this month's verification visits. A random few of the project's farmers, each visited by
 * someone who did not collect their records; the share visited is tracked month by month.
 */
export function VerificationPanel({ code }: { code: string }) {
  const { user } = useSession();
  const [v, setV] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    if (!user) return;
    const r = await fetch(`/api/projects/${encodeURIComponent(code)}/verification`, { cache: "no-store", headers: { "x-demo-user": user.id } });
    if (r.ok) setV(await r.json());
  }, [code, user]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!user || !v) return null;
  const post = async (b: unknown) => {
    setError("");
    const r = await fetch(`/api/projects/${encodeURIComponent(code)}/verification`, { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": user.id }, body: JSON.stringify(b) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return setError(body.error ?? plainError(r.status));
    setV(body);
  };
  const now = v.months.find((m) => m.month === v.month);
  return (
    <section className="mt-8" aria-labelledby="verify-heading">
      <h2 id="verify-heading" className="font-semibold">
        Verification visits, {v.month}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">Each month {Math.round(v.rate * 100)}% of farmers, chosen at random, are visited by someone who did not collect their records.</p>
      {error && <p className="mt-2 text-sm text-clay">{error}</p>}
      {!v.drawn && v.may.draw && (
        <button type="button" className={`${primaryBtn} mt-2`} onClick={() => void post({ action: "draw" })}>
          Draw this month&apos;s sample
        </button>
      )}
      {!v.drawn && !v.may.draw && <p className="mt-2 text-sm text-muted">Not drawn yet: MEL or the project manager draws it.</p>}
      {now && (
        <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
          {now.visits.map((x) => (
            <li key={x.farmer} className="py-2">
              <Link href={`/work?source=field&open=${encodeURIComponent(x.farmer)}`} className="font-semibold text-forest underline">
                {x.farmer}
              </Link>{" "}
              · collected by {x.collectorName ?? "nobody yet"} · visit: {x.assigneeName ?? "MEL (everyone else collected)"}
              {x.done ? (
                <span className={`block ${x.done.result === "discrepancy" ? "text-clay" : "text-leaf"}`}>
                  {x.done.result === "confirmed" ? "Confirmed" : "Found a discrepancy"} by {x.done.byName}, {x.done.at}: {x.done.note}
                </span>
              ) : (
                x.mine && (
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    <input value={note[x.farmer] ?? ""} onChange={(e) => setNote({ ...note, [x.farmer]: e.target.value })} placeholder="What you saw" className="min-w-[14rem] flex-1 border border-line px-2 py-1.5" />
                    <button type="button" className={primaryBtn} onClick={() => void post({ action: "visit", month: v.month, farmer: x.farmer, result: "confirmed", note: note[x.farmer] ?? "" })}>
                      Matches the records
                    </button>
                    <button type="button" className={quietBtn} onClick={() => void post({ action: "visit", month: v.month, farmer: x.farmer, result: "discrepancy", note: note[x.farmer] ?? "" })}>
                      Does not match
                    </button>
                  </span>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      {v.months.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          Visited: {v.months.slice(0, 6).map((m) => `${m.month} ${m.done}%`).join(" · ")}
        </p>
      )}
    </section>
  );
}
