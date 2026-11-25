"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/components/app/session";
import { longDate } from "@/lib/weekly";

type Origin = { proposalId: string | null; opportunityId: string | null; title: string; donor: string; decidedAt: string | null };

/**
 * Where the project comes from (lib/project-origin): the won proposal, linked back, as a ruled row
 * among the project's settings. Nothing shows for a project set up without one.
 */
export function ProjectOriginRow({ code, className }: { code: string; className: string }) {
  const { user } = useSession();
  const [origin, setOrigin] = useState<Origin | null>(null);
  useEffect(() => {
    if (!user || user.kind !== "employee") return;
    let live = true;
    fetch(`/api/projects/${encodeURIComponent(code)}/origin`, { cache: "no-store", headers: { "x-demo-user": user.id } })
      .then((r) => (r.ok ? (r.json() as Promise<{ origin: Origin | null }>) : { origin: null }))
      .then((b) => live && setOrigin(b.origin))
      .catch(() => live && setOrigin(null));
    return () => {
      live = false;
    };
  }, [code, user]);
  if (!origin) return null;
  const href = origin.proposalId ? `/work/proposals?open=${encodeURIComponent(origin.proposalId)}` : "/work/opportunities";
  return (
    <Link href={href} className={className}>
      <span>
        Comes from {origin.proposalId ? "proposal" : "opportunity"} {origin.title}
        <span className="block text-xs font-normal text-muted">
          {origin.donor}
          {origin.decidedAt ? ` · ${origin.proposalId ? "won" : "matched"} ${longDate(origin.decidedAt)}` : ""}
        </span>
      </span>
      <span aria-hidden>→</span>
    </Link>
  );
}
