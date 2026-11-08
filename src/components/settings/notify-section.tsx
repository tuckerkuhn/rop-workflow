"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session";

type Prefs = { off: boolean; last: string | null; configured: boolean; preview: { key: string; project: string; text: string; urgent: boolean }[] | null };

/** Your daily email: on or off, and what it would say today. */
export function NotifySection() {
  const { actor } = useSession();
  const [p, setP] = useState<Prefs | null>(null);
  const [error, setError] = useState("");
  const call = useCallback(
    async (init?: RequestInit, preview = false) => {
      const res = await fetch(`/api/notify/prefs${preview ? "?preview=1" : ""}`, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": actor?.id ?? "" } });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Could not load.");
      return d as Prefs;
    },
    [actor?.id],
  );
  useEffect(() => {
    if (actor) call().then(setP, (e) => setError(String(e.message ?? e)));
  }, [actor, call]);
  if (!actor) return null;
  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
      <h2 className="font-display text-xl">Daily email</h2>
      <p className="mt-1 text-sm text-muted">
        Each morning when something new needs you, and on Mondays if anything is still waiting. It leads with what affects results: targets slipping, activities you own that are late or not started, results waiting to count. Sign-offs, imports, procurement steps and tasks follow, briefly.
      </p>
      {error && <p className="mt-2 text-sm text-clay">{error}</p>}
      {p && (
        <>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!p.off}
              onChange={(e) =>
                call({ method: "POST", body: JSON.stringify({ off: !e.target.checked }) }).then(
                  (x) => setP({ ...p, ...x }),
                  (er) => setError(String(er.message ?? er)),
                )
              }
            />
            Send me the daily email
          </label>
          <p className="mt-1 text-xs text-muted">
            {p.last ? `Last sent ${p.last}.` : "Not sent yet."}
            {!p.configured && " Email is not switched on for this site yet (an administrator sets it up)."}
          </p>
          <button type="button" className="mt-2 text-sm font-semibold text-forest hover:underline" onClick={() => call(undefined, true).then(setP, (er) => setError(String(er.message ?? er)))}>
            What would it say today?
          </button>
          {p.preview &&
            (p.preview.length ? (
              <ul className="mt-2 space-y-1 text-sm">
                {p.preview.map((i) => (
                  <li key={i.key}>
                    {i.text}{" "}
                    <span className="text-xs text-muted">
                      · {i.project}
                      {i.urgent ? " · now" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">Nothing is waiting for you.</p>
            ))}
        </>
      )}
    </section>
  );
}
