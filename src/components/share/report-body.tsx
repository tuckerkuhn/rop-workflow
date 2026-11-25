import type { ReactNode } from "react";
import type { DonorSafeReport } from "@/server/share-store";

/**
 * The body of a quarterly report as a donor reads it: each figure with the records behind it,
 * the written sections and the photos. One body for the emailed link (app/share) and the donor's
 * own account (components/donor), so the two always read the same. How a photo is fetched differs
 * between them (a link needs no sign-in, an account does), so the caller draws the photo.
 */

export const num = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
export const longDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Draws one photo with its caption: small beside a record, large in the report's photo grid. */
export type PhotoSlot = (p: { hash: string; caption: string }, size: "record" | "grid") => ReactNode;

export function ReportBody({ v, photo }: { v: Pick<DonorSafeReport, "rows" | "sections" | "photos">; photo: PhotoSlot }) {
  return (
    <>
      <section className="mt-8">
        <h2 className="font-display text-2xl">Progress towards results</h2>
        <div className="mt-3 space-y-2">
          {v.rows.map((r) => (
            <details key={r.code} className="rounded-xl border border-line bg-surface px-4 py-3">
              <summary className="cursor-pointer list-none">
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <p className="text-sm">
                    <span className="font-mono text-xs text-muted">{r.donorCode} </span>
                    {r.name} <span className="text-muted">({r.unit})</span>
                  </p>
                  <p className="text-sm tabular-nums sm:text-end">
                    <span className="font-semibold">{r.note?.quarter ?? num(r.quarter)}</span> this quarter · {r.note?.year ? `${r.note.year} · target ${num(r.yearTarget)}` : `${num(r.year)} of ${num(r.yearTarget)}`} this year · {r.status}
                  </p>
                </div>
                <p className="mt-1 text-xs font-semibold text-forest">{r.records.length ? `${r.records.length} ${r.records.length === 1 ? "record" : "records"} behind this figure ▾` : "No records this quarter"}</p>
              </summary>
              {r.comment && <p className="mt-2 text-sm text-muted">{r.comment}</p>}
              <ul className="mt-3 space-y-3">
                {r.records.map((x, k) => (
                  <li key={k} className="rounded-lg bg-paper p-3 text-sm">
                    <p>
                      <span className="font-semibold tabular-nums">{num(x.value)}</span> {x.value === 1 ? r.unit.replace(/s$/, "") : r.unit} · {longDay(x.date)}
                      {x.place ? ` · ${x.place}` : ""}
                    </p>
                    {x.accepted && (
                      <p className="text-xs text-muted">
                        Accepted by {x.accepted.by} on {longDay(x.accepted.on)}
                      </p>
                    )}
                    {x.photos.length > 0 && <div className="mt-2 flex flex-wrap gap-3">{x.photos.map((p) => photo(p, "record"))}</div>}
                    {x.documents.length > 0 && <p className="mt-2 text-xs text-muted">Also on file with Roots of Peace, available on request: {x.documents.join("; ")}.</p>}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </section>

      {v.sections.length > 0 && (
        <section className="mt-10 space-y-6">
          {v.sections.map((x) => (
            <div key={x.heading}>
              <h2 className="text-xl font-semibold">{x.heading}</h2>
              <div className="mt-2 space-y-2 text-sm leading-relaxed">
                {x.text.split(/\n{2,}/).map((para, k) => (
                  <p key={k} className="whitespace-pre-line">
                    {para}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {v.photos.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-2xl">Photos</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{v.photos.map((p) => photo(p, "grid"))}</div>
        </section>
      )}
    </>
  );
}
