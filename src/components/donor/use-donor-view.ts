"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/app/session";
import type { DonorReportView, DonorView } from "@/server/donor-view-store";

/** Loads one of the donor-view answers for the signed-in person. `path` is null until there is something to ask for. */
function useAnswer<T>(path: string | null) {
  const { user, ready } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const userId = user?.id;
  useEffect(() => {
    if (!ready || !userId || !path) return;
    let live = true;
    fetch(path, { cache: "no-store", headers: { "x-demo-user": userId } })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((d as { error?: string }).error ?? "Could not load this page.");
        if (live) {
          setData(d as T);
          setError("");
        }
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [ready, userId, path]);
  return { data, error };
}

const asDonor = (donorId?: string | null) => (donorId ? `?donor=${encodeURIComponent(donorId)}` : "");

/** The released reports, the money as the latest of them gave it, and the next report date. `donorId` is for staff looking as a donor. */
export const useDonorView = (code: string | null, donorId?: string | null) => useAnswer<DonorView>(code ? `/api/projects/${encodeURIComponent(code)}/donor-view${asDonor(donorId)}` : null);

/** One released report with the donor's money as it gave it. */
export const useDonorReport = (code: string | null, quarter: string, donorId?: string | null) =>
  useAnswer<DonorReportView>(code ? `/api/projects/${encodeURIComponent(code)}/donor-view/${quarter}${asDonor(donorId)}` : null);

export const quarterLabel = (q: string) => q.replace("-", " ");
