/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import { ReportBody, longDay, type PhotoSlot } from "@/components/share/report-body";
import { DraftWatermark } from "@/components/share/draft-watermark";
import { periodNotEnded } from "@/lib/early-draft";
import { sharedReport } from "@/server/share-store";

/**
 * The donor's read-only view of a quarterly report, opened from a link Roots of Peace sends.
 * Each figure opens the records behind it: date, place and captioned photos. No sign-in.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shared report · Roots of Peace", robots: { index: false, follow: false } };

const day = longDay;

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
  const src = (hash: string) => `/api/share/${encodeURIComponent(code)}/${token}/photo/${hash}`;
  // A link needs no sign-in, so its photos are plain images.
  const draw: PhotoSlot = (p, size) =>
    size === "record" ? (
      <a key={p.hash} href={src(p.hash)} target="_blank" rel="noreferrer" className="w-44 text-xs text-muted">
        <img src={src(p.hash)} alt={p.caption} loading="lazy" className="h-28 w-44 rounded-md object-cover" />
        <span className="mt-1 block">{p.caption}</span>
      </a>
    ) : (
      <a key={p.hash} href={src(p.hash)} target="_blank" rel="noreferrer" className="text-sm text-muted">
        <img src={src(p.hash)} alt={p.caption} loading="lazy" className="aspect-[4/3] w-full rounded-lg object-cover" />
        <span className="mt-1 block">{p.caption}</span>
      </a>
    );
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warn">{v.project.donor ?? ""}</p>
      <h1 className="mt-1 font-display text-3xl tracking-tight sm:text-4xl">{v.project.name}</h1>
      <p className="mt-1 text-lg">Quarterly progress report, {v.quarter.replace("-", " ")}</p>
      <p className="mt-2 text-sm text-muted">
        {v.status === "released" ? `Released by Roots of Peace on ${day(v.asOf)}.` : `A draft shared for review, as it stood on ${day(v.asOf)}.`} Each figure opens the records behind it. This link works until {day(v.expires)}.
      </p>

      {/* Sent before its period ended: nobody should take it for the final report. */}
      {periodNotEnded(v.period.to) && <DraftWatermark to={v.period.to} />}

      <ReportBody v={v} photo={draw} />
      <p className="mt-12 border-t border-line pt-4 text-xs text-muted">Shared by Roots of Peace. Records show district and province only; attendance sheets and other documents with personal details are not opened from this page.</p>
    </main>
  );
}
