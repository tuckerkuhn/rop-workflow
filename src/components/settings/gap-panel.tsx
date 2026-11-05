"use client";

import { useState } from "react";
import { primaryBtn } from "@/components/workspace/ui";

/**
 * Gaps: requirements stricter than the organization's procedures. Each is shown against what the
 * procedures say now; a person ticks the ones to layer on and says why. Nothing applies until then.
 */
export type GapItem = { key: string; label: string; ours: string; required: string; result: string; source: string };

export function GapPanel({
  title,
  intro,
  items,
  canApprove,
  cannot,
  onApprove,
}: {
  title: string;
  intro: string;
  items: GapItem[];
  canApprove: boolean;
  /** Shown instead of the approve controls to someone who cannot approve. */
  cannot: string;
  onApprove: (keys: string[], reason: string) => Promise<void>;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(items.map((i) => i.key)));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!items.length) return null;
  const keys = items.map((i) => i.key).filter((k) => picked.has(k));
  return (
    <section className="mt-6 rounded-2xl border border-ochre bg-ochre-soft/50 p-4">
      <p className="font-semibold text-ochre">{title}</p>
      <p className="mt-1 text-sm text-muted">{intro}</p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="text-xs text-muted">
            <tr>
              {canApprove && <th className="w-8 px-3 py-2" />}
              <th className="px-3 py-2 text-start font-medium">Requirement</th>
              <th className="px-3 py-2 text-start font-medium">Our procedures</th>
              <th className="px-3 py-2 text-start font-medium">Required</th>
              <th className="px-3 py-2 text-start font-medium">Once layered on</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line align-top">
            {items.map((i) => (
              <tr key={i.key}>
                {canApprove && (
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Layer on: ${i.label}`}
                      checked={picked.has(i.key)}
                      onChange={(e) =>
                        setPicked((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(i.key);
                          else n.delete(i.key);
                          return n;
                        })
                      }
                    />
                  </td>
                )}
                <td className="px-3 py-2">
                  {i.label}
                  <span className="block text-xs text-muted">{i.source}</span>
                </td>
                <td className="px-3 py-2">{i.ours}</td>
                <td className="px-3 py-2 font-medium">{i.required}</td>
                <td className="px-3 py-2">{i.result}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canApprove ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (kept with the approval)" aria-label="Reason for layering these on" className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
          <button
            type="button"
            disabled={busy || !keys.length || reason.trim().length < 5}
            className={primaryBtn}
            onClick={async () => {
              setBusy(true);
              try {
                await onApprove(keys, reason.trim());
                setReason("");
              } catch {
                /* the caller shows the error */
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : `Layer on ${keys.length} of ${items.length}`}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">{cannot}</p>
      )}
    </section>
  );
}
