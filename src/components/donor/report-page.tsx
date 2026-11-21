"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { useRequireUser } from "@/components/app/session";
import { MoneySection, MoneySentence } from "@/components/donor/money";
import { PreviewNote } from "@/components/donor/reports-page";
import { quarterLabel, useDonorReport, useDonorView } from "@/components/donor/use-donor-view";
import { ReportBody, longDay, type PhotoSlot } from "@/components/share/report-body";
import { TopBar } from "@/components/workspace/ui";

/**
 * One released quarterly report inside a donor's account: the same report as the emailed link
 * (components/share/report-body), in that donor's own format, followed by how their grant is
 * being spent as this report gave it.
 */

/** A photo for a signed-in reader. It is asked for when it comes into view, so the photos behind closed figures cost nothing. */
function AccountPhoto({ src, caption, size, user }: { src: string; caption: string; size: "record" | "grid"; user: string }) {
  const [url, setUrl] = useState("");
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let made = "";
    let live = true;
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      fetch(src, { headers: { "x-demo-user": user } })
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => {
          if (b && live) setUrl((made = URL.createObjectURL(b)));
        })
        .catch(() => undefined);
    });
    seen.observe(el);
    return () => {
      live = false;
      seen.disconnect();
      if (made) URL.revokeObjectURL(made);
    };
  }, [src, user]);
  const shape = size === "record" ? "h-28 w-44 rounded-md" : "aspect-[4/3] w-full rounded-lg";
  return (
    <figure ref={box} className={size === "record" ? "w-44 text-xs text-muted" : "text-sm text-muted"}>
      {url ? <img src={url} alt={caption} className={`${shape} object-cover`} /> : <div className={`${shape} bg-sunken`} />}
      <figcaption className="mt-1">{caption}</figcaption>
    </figure>
  );
}

export function DonorReportPage({ quarter }: { quarter: string }) {
  const { user } = useRequireUser();
  const { project } = useCurrentProject();
  const asked = useSearchParams().get("donor");
  const router = useRouter();
  const { tx } = useT();
  const code = project.saved ? project.id : null;
  const { data, error } = useDonorReport(code, quarter, asked);
  // Staff choosing between donors need the list; a donor never asks for it.
  const list = useDonorView(user?.kind === "employee" ? code : null, asked).data;
  if (!user) return null;
  const withDonor = asked ? `?donor=${encodeURIComponent(asked)}` : "";
  const photo: PhotoSlot = (p, size) => (
    <AccountPhoto key={p.hash} src={`/api/projects/${encodeURIComponent(project.id)}/donor-view/${quarter}/photo/${p.hash}`} caption={p.caption} size={size} user={user.id} />
  );
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {list && <PreviewNote view={list} onPick={(id) => router.replace(`/progress/released/${quarter}?donor=${encodeURIComponent(id)}`)} />}
        <Link href={`/progress/released${withDonor}`} className="text-sm font-semibold text-forest hover:underline">
          ← {tx("Reports")}
        </Link>
        {error && (
          <p role="alert" className="mt-6 rounded-xl bg-sunken px-4 py-3 text-sm">
            {error}
          </p>
        )}
        {!data && !error && <p className="mt-6 text-sm text-muted">{tx("Loading…")}</p>}
        {data && (
          <>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-warn">{data.report.project.donor ?? ""}</p>
            <h1 className="mt-1 font-display text-3xl tracking-tight sm:text-4xl">{data.report.project.name}</h1>
            <p className="mt-1 text-lg">{tx("Quarterly progress report, {quarter}", { quarter: quarterLabel(data.report.quarter) })}</p>
            <p className="mt-2 text-sm text-muted">{tx("Released by Roots of Peace on {date}. Each figure opens the records behind it.", { date: longDay(data.report.asOf) })}</p>
            {data.money && (
              <p className="mt-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
                <MoneySentence money={data.money} />{" "}
                <a href="#money" className="font-semibold text-forest hover:underline">
                  {tx("See every budget line")} ↓
                </a>
              </p>
            )}
            <ReportBody v={data.report} photo={photo} />
            <MoneySection money={data.money} note={data.moneyNote} preview={data.preview} />
            <p className="mt-12 border-t border-line pt-4 text-xs text-muted">
              {tx("Records show district and province only. Attendance sheets and other documents with personal details are not opened from this page: Roots of Peace provides them on request.")}
            </p>
          </>
        )}
      </main>
    </div>
  );
}
