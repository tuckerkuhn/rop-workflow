"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/app/session";
import { onOutboxChange, outbox, removeFromOutbox, sendOutbox, type OutboxEntry } from "@/lib/outbox";

/**
 * Registers the service worker (so the app opens without a connection) and sends the phone's
 * outbox whenever the connection comes back. Shows what is waiting, and anything refused.
 */
export function OfflineSupport() {
  const { user } = useSession();
  const [waiting, setWaiting] = useState<OutboxEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!user || typeof indexedDB === "undefined") return;
    const refresh = () => void outbox(user.id).then(setWaiting).catch(() => undefined);
    const send = () => void sendOutbox(user.id).then(refresh).catch(refresh);
    const net = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) send();
    };
    setOnline(navigator.onLine);
    send();
    const off = onOutboxChange(refresh);
    window.addEventListener("online", net);
    window.addEventListener("offline", net);
    const timer = setInterval(send, 60_000);
    return () => {
      off();
      window.removeEventListener("online", net);
      window.removeEventListener("offline", net);
      clearInterval(timer);
    };
  }, [user]);
  if (!user || (online && !waiting.length)) return null;
  const refused = waiting.filter((e) => e.error);
  return (
    <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-2 pt-[env(safe-area-inset-top)]">
      <div className="mt-1 max-w-md rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg">
        <button type="button" className="font-semibold" onClick={() => setOpen(!open)}>
          {!online ? "No connection. " : ""}
          {waiting.length ? `${waiting.length} saved on this phone, ${online ? "sending…" : "will send when the connection is back"}` : "Anything you save waits on this phone."}
          {refused.length ? ` · ${refused.length} refused` : ""}
        </button>
        {open && waiting.length > 0 && (
          <ul className="mt-2 space-y-1">
            {waiting.map((e) => (
              <li key={e.id} className="flex gap-2">
                <span className="min-w-0 flex-1">
                  {e.label} <span className="text-muted">· {e.at.slice(0, 16).replace("T", " ")}</span>
                  {e.error && <span className="block text-clay">Refused: {e.error}</span>}
                </span>
                {e.error && (
                  <button type="button" className="text-muted hover:text-clay" onClick={() => window.confirm("Remove this from the phone? It was not saved.") && void removeFromOutbox(e.id)}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
