"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useState } from "react";
import type { FamiliesView } from "@/server/families";

/**
 * Home's first block: what the work came to for people this quarter, and one family beside the
 * numbers ("warmth made visible", Brand Foundation Book 1). Women and men per result, never summed.
 */
const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });

function Photo({ hash, user, alt }: { hash: string; user: string; alt: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let url = "";
    fetch(`/api/files/${hash}`, { headers: { "x-demo-user": user } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => b && setSrc((url = URL.createObjectURL(b))))
      .catch(() => undefined);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [hash, user]);
  return src ? <img src={src} alt={alt} className="h-40 w-full rounded-xl object-cover sm:h-full" /> : <div className="h-40 w-full rounded-xl bg-sunken sm:h-full" />;
}

export function Families({ project, user, mayWriteStory }: { project: string; user: string; mayWriteStory: boolean }) {
  const [v, setV] = useState<FamiliesView | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/projects/${project}/families`, { cache: "no-store", headers: { "x-demo-user": user } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && d && setV(d))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [project, user]);
  if (!v) return null;
  const label = v.quarter.replace("-", " ");
  return (
    <section aria-label="What the work came to" className="grid gap-4 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0">
        <h2 className="font-display text-xl">{v.current ? `So far in ${label}` : `What ${label} came to`}</h2>
        {v.results.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No results accepted yet for {label}.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {v.results.map((r) => (
              <li key={r.code}>
                <p className="text-base leading-snug">
                  <span className="font-display text-2xl tabular-nums">{n(r.value)}</span> <span className="font-semibold">{r.unit}</span>
                  <span className="text-muted"> · {r.what}</span>
                </p>
                {(r.women > 0 || r.men > 0) && (
                  <p className="text-xs text-muted">
                    {n(r.women)} women, {n(r.men)} men
                  </p>
                )}
                {(r.womenLed > 0 || r.menLed > 0) && (
                  <p className="text-xs text-muted">
                    {n(r.womenLed)} women-led, {n(r.menLed)} men-led businesses
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {v.more > 0 && (
          <Link href="/progress" className="mt-3 inline-block text-sm font-semibold text-forest hover:underline">
            and {v.more} more results →
          </Link>
        )}
      </div>
      {v.story ? (
        <Link href="/progress/stories" className="group grid gap-3 rounded-xl bg-paper p-3 sm:grid-rows-[10rem_auto]">
          {v.story.photo ? <Photo hash={v.story.photo.hash} user={user} alt={v.story.photo.caption || v.story.title} /> : <div className="hidden" />}
          <div>
            <p className="font-semibold group-hover:text-forest">{v.story.title}</p>
            <p className="mt-1 line-clamp-3 text-sm text-muted">{v.story.excerpt}…</p>
            <p className="mt-1 text-xs text-muted">{[v.story.firstName, v.story.place].filter(Boolean).join(" · ")}</p>
          </div>
        </Link>
      ) : (
        <div className="flex flex-col justify-center rounded-xl border border-dashed border-line p-4 text-sm text-muted">
          <p>Behind every figure is a family. No story is approved yet for this project.</p>
          {mayWriteStory && (
            <Link href="/progress/stories" className="mt-2 font-semibold text-forest hover:underline">
              Write the first one, with their consent →
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
