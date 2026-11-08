"use client";

import { useEffect, useState } from "react";

/**
 * The reason for changing a signed-off plan in setup. Kept for the browser session per project and
 * sent with each save (header x-change-reason); the server refuses a signed-off change without one
 * and writes it to the audit trail.
 */

const key = (code: string) => `rop-change-reason:${code}`;

export function changeReasonHeader(url: string): Record<string, string> {
  const code = url.match(/\/api\/projects\/([^/?]+)/)?.[1];
  if (!code) return {};
  try {
    const r = sessionStorage.getItem(key(decodeURIComponent(code)));
    return r ? { "x-change-reason": encodeURIComponent(r) } : {};
  } catch {
    return {};
  }
}

export function SignedOffBanner({ code, stage }: { code: string; stage: string }) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    try {
      setReason(sessionStorage.getItem(key(code)) ?? "");
    } catch {
      /* private window: the box still works for this page */
    }
  }, [code]);
  const set = (v: string) => {
    setReason(v);
    try {
      sessionStorage.setItem(key(code), v);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="mb-6 rounded-2xl border border-ochre/40 bg-ochre-soft px-4 py-3 text-sm">
      <p className="font-semibold">This plan is signed off ({stage}).</p>
      <p className="mt-1">
        Changes to targets, budget and workplan normally go through the monthly review, where a second reviewer approves them. Only a plan approver can change them here, with a reason, and the change goes in the audit trail.
      </p>
      <label className="mt-2 block">
        Why is the plan being changed?
        <input className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2" value={reason} onChange={(e) => set(e.target.value)} placeholder="UNDP approved the revised budget on 21 Oct 2026 (email from the Project Manager)" />
      </label>
    </div>
  );
}
