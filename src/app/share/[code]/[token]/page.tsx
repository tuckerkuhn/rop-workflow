/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import { sharedReport } from "@/server/share-store";

/**
 * The donor's read-only view of a quarterly report, opened from a link Roots of Peace sends.
 * Each figure opens the records behind it: date, place and captioned photos. No sign-in.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shared report · Roots of Peace", robots: { index: false, follow: false } };

const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default async function Page({ params }: { params: Promise<{ code: string; token: string }> }) {
  const { code, token } = await params;
  const v = await sharedReport(decodeURIComponent(code), token);
  if ("error" in v)
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="font-display text-2xl">Roots of Peace</p>
        <p className="mt-4 text-muted">{v.error}</p>
      </main>
    );
  const photo = (hash: string) => `/api/share/${encodeURIComponent(code)}/${token}/photo/${hash}`;
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">{v.project.donor ?? ""}</p>
      <h1 className="mt-1 font-display text-3xl tracking-tight sm:text-4xl">{v.project.name}</h1>
      <p className="mt-1 text-lg">Quarterly progress report, {v.quarter.replace("-", " ")}</p>
      <p className="mt-2 text-sm text-muted">
        {v.status === "released" ? `Released by Roots of Peace on ${day(v.asOf)}.` : `A draft shared for review, as it stood on ${day(v.asOf)}.`} Each figure opens the records behind it. This link works until {day(v.expires)}.
      </p>

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
                    <span className="font-semibold">{n(r.quarter)}</span> this quarter · {n(r.year)} of {n(r.yearTarget)} this year · {r.status}
                  </p>
                </div>
                <p className="mt-1 text-xs font-semibold text-forest">{r.records.length ? `${r.records.length} ${r.records.length === 1 ? "record" : "records"} behind this figure ▾` : "No records this quarter"}</p>
              </summary>
              {r.comment && <p className="mt-2 text-sm text-muted">{r.comment}</p>}
              <ul className="mt-3 space-y-3">
                {r.records.map((x, k) => (
                  <li key={k} className="rounded-lg bg-paper p-3 text-sm">
                    <p>
                      <span className="font-semibold tabular-nums">{n(x.value)}</span> {r.unit} · {x.date}
                      {x.place ? ` · ${x.place}` : ""}
                    </p>
                    {x.accepted && (
                      <p className="text-xs text-muted">
                        Accepted by {x.accepted.by} on {day(x.accepted.on)}
                      </p>
                    )}
                    {x.photos.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-3">
                        {x.photos.map((p) => (
                          <a key={p.hash} href={photo(p.hash)} target="_blank" rel="noreferrer" className="w-44 text-xs text-muted">
                            <img src={photo(p.hash)} alt={p.caption} loading="lazy" className="h-28 w-44 rounded-md object-cover" />
                            <span className="mt-1 block">{p.caption}</span>
                          </a>
                        ))}
                      </div>
                    )}
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
              <h2 className="font-display text-xl">{x.heading}</h2>
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
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {v.photos.map((p) => (
              <a key={p.hash} href={photo(p.hash)} target="_blank" rel="noreferrer" className="text-sm text-muted">
                <img src={photo(p.hash)} alt={p.caption} loading="lazy" className="aspect-[4/3] w-full rounded-lg object-cover" />
                <span className="mt-1 block">{p.caption}</span>
              </a>
            ))}
          </div>
        </section>
      )}
      <p className="mt-12 border-t border-line pt-4 text-xs text-muted">Shared by Roots of Peace. Records show district and province only; attendance sheets and other documents with personal details are not opened from this page.</p>
    </main>
  );
}
