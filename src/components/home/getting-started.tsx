"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FirstStep } from "@/app/api/projects/[code]/first-run/route";

/** The first steps for this person's role, ticked from what they have done; gone once all are done or hidden. */
export function GettingStarted({ project, user }: { project: string; user: string }) {
  const key = `rop-getting-started-hidden:${user}:${project}`;
  const [steps, setSteps] = useState<FirstStep[] | null>(null);
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(key) === "1");
    } catch {
      setHidden(false);
    }
    let live = true;
    fetch(`/api/projects/${project}/first-run`, { cache: "no-store", headers: { "x-demo-user": user } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && d && setSteps(d.steps))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [project, user, key]);
  if (!steps || hidden) return null;
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  return (
    <section aria-label="Getting started" className="rounded-2xl border border-forest/30 bg-mist p-4">
      <div className="flex items-baseline gap-3">
        <h2 className="font-display text-xl">Getting started</h2>
        <span className="text-sm text-muted">
          {done} of {steps.length} done
        </span>
        <button
          type="button"
          className="ms-auto text-xs text-muted hover:text-ink"
          onClick={() => {
            try {
              localStorage.setItem(key, "1");
            } catch {}
            setHidden(true);
          }}
        >
          Hide
        </button>
      </div>
      <ol className="mt-2 space-y-1 text-sm">
        {steps.map((s) => (
          <li key={s.key} className="flex gap-2">
            <span aria-hidden className={s.done ? "text-leaf" : "text-muted"}>
              {s.done ? "✓" : "○"}
            </span>
            {s.done ? (
              <span className="text-muted line-through">{s.text}</span>
            ) : (
              <Link href={s.href} className="font-semibold text-forest hover:underline">
                {s.text}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
