"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/app/i18n";
import { WhereWhen } from "@/components/field/where-when";
import { plainError } from "@/lib/plain-error";
import type { DistFacts } from "@/server/distribution-photo";
import type { ProofPhoto } from "@/server/submission-proof";

/**
 * The proof behind one KoboCollect form, opened by the person checking it: its photos (each named
 * by the question it was taken on) and where and when it was made. Loaded only when asked for, so
 * a long queue stays fast on a field connection.
 */
export function RecordProof({ code, id, userId }: { code: string; id: string; userId: string }) {
  const { tx } = useT();
  const [proof, setProof] = useState<{ photos: ProofPhoto[]; facts: DistFacts } | null>(null);
  const [shots, setShots] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const url = `/api/projects/${encodeURIComponent(code)}/submissions/${id}/proof`;

  useEffect(() => {
    let gone = false;
    const made: string[] = [];
    const headers = { "x-demo-user": userId };
    void (async () => {
      try {
        const res = await fetch(url, { cache: "no-store", headers });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? plainError(res.status));
        if (gone) return;
        setProof(body);
        for (const p of (body.photos ?? []) as ProofPhoto[]) {
          const img = await fetch(`${url}?photo=${encodeURIComponent(p.question)}`, { headers });
          if (!img.ok) throw new Error(((await img.json().catch(() => ({}))) as { error?: string }).error ?? plainError(img.status));
          const src = URL.createObjectURL(await img.blob());
          made.push(src);
          if (!gone) setShots((k) => ({ ...k, [p.question]: src }));
        }
      } catch (e) {
        if (!gone) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      gone = true;
      made.forEach((m) => URL.revokeObjectURL(m));
    };
  }, [url, userId]);

  if (error && !proof) return <p className="mt-3 text-sm text-clay">{error}</p>;
  if (!proof) return <p className="mt-3 text-sm text-muted">{tx("Fetching the photo from KoboToolbox…")}</p>;
  return (
    <div className="mt-3 rounded-lg border border-line bg-surface px-3 py-3">
      {proof.photos.length === 0 && <p className="text-sm text-muted">{tx("KoboToolbox holds no photo for this record yet. If the phone is still uploading, sync again in a few minutes.")}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {proof.photos.map((p) => (
          <figure key={p.question}>
            {shots[p.question] ? (
              // eslint-disable-next-line @next/next/no-img-element -- fetched from the project's KoboToolbox account, shown from memory
              <img src={shots[p.question]} alt={tx(p.label)} className="max-h-80 w-full rounded-lg border border-line bg-mist object-contain" />
            ) : (
              <div className="grid h-32 place-items-center rounded-lg border border-line bg-mist text-xs text-muted">{tx("Loading…")}</div>
            )}
            <figcaption className="mt-1 text-xs text-muted">{tx(p.label)}</figcaption>
          </figure>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-clay">{error}</p>}
      <div className="mt-3">
        <WhereWhen facts={proof.facts} compact />
      </div>
    </div>
  );
}
