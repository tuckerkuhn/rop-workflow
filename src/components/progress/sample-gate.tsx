"use client";

import { useEffect, useState } from "react";

/**
 * MF-10 (D-26): before many records are accepted at once, a random sample of them is opened and
 * checked. Lists the sample, each with a box to tick once looked at; calls `onReady` with the ids
 * opened once every one is ticked.
 */
export function SampleGate({ items, onReady, open }: { items: { id: string; label: string }[]; onReady: (opened: string[] | null) => void; open?: (id: string) => void }) {
  const [seen, setSeen] = useState<string[]>([]);
  const key = items.map((i) => i.id).join(",");
  useEffect(() => {
    setSeen([]);
  }, [key]);
  useEffect(() => {
    onReady(items.length && items.every((i) => seen.includes(i.id)) ? seen : null);
  }, [seen, items, onReady]);
  if (!items.length) return null;
  return (
    <div className="w-full text-sm">
      <p className="text-muted">
        First open {items.length === 1 ? "this one, chosen" : `these ${items.length}, chosen`} at random, and check {items.length === 1 ? "it" : "each"}:
      </p>
      <ul className="mt-1 space-y-1">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2">
            {open ? (
              <button type="button" className="font-semibold text-forest underline" onClick={() => open(i.id)}>
                {i.label}
              </button>
            ) : (
              <span className="font-semibold">{i.label}</span>
            )}
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={seen.includes(i.id)} onChange={(e) => setSeen(e.target.checked ? [...seen, i.id] : seen.filter((x) => x !== i.id))} />
              I opened it and it is right
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
