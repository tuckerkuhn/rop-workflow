"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/app/i18n";

/**
 * A small "Saving…" sign while changes are on their way to the server, then "Saved" for a moment,
 * so on a slow connection nobody closes the phone before a tick has reached the record.
 *
 *   trackSave(promise)   // from any save queue
 */
let pending = 0;
const listeners = new Set<(n: number) => void>();
const tell = () => listeners.forEach((f) => f(pending));

export function trackSave<T>(p: Promise<T>): Promise<T> {
  pending++;
  tell();
  return p.finally(() => {
    pending--;
    tell();
  });
}

export function SavingSign() {
  const { tx } = useT();
  const [n, setN] = useState(0);
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const f = (next: number) => {
      setN((prev) => {
        if (prev > 0 && next === 0) {
          setJustSaved(true);
          clearTimeout(timer);
          timer = setTimeout(() => setJustSaved(false), 1500);
        }
        return next;
      });
    };
    listeners.add(f);
    return () => {
      listeners.delete(f);
      clearTimeout(timer);
    };
  }, []);
  if (!n && !justSaved) return null;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-2 z-50 flex justify-center">
      <span className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted shadow-sm">{n ? tx("Saving…") : tx("Saved")}</span>
    </div>
  );
}
