"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/components/app/session";
import { seedStock, type FieldItem, type Stock } from "@/lib/field";
import type { Roster, Submission } from "@/lib/project";

/**
 * Field activities and the review queue, read from and saved to the database through the API.
 * Replaces the browser storage these screens used before.
 */

type Load = "loading" | "ready" | "error";

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export function useFieldData(code = "A-2027") {
  const { user, ready } = useSession();
  const [items, setItemsState] = useState<FieldItem[]>([]);
  const [stock, setStockState] = useState<Stock>(seedStock);
  const [status, setStatus] = useState<Load>("loading");
  const [error, setError] = useState("");
  const current = useRef<FieldItem[]>([]);
  const currentStock = useRef<Stock>(seedStock());

  const reload = useCallback(async () => {
    try {
      const r = await call<{ items: FieldItem[]; stock: Stock | null }>(`/api/projects/${code}/field`, user?.id);
      current.current = r.items;
      setItemsState(r.items);
      if (r.stock) {
        currentStock.current = r.stock;
        setStockState(r.stock);
      }
      setStatus("ready");
      setError("");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [code, user?.id]);

  useEffect(() => {
    if (ready && user) void reload();
  }, [ready, user, reload]);

  const save = useCallback(
    (body: { items?: FieldItem[]; stock?: Stock }) =>
      call(`/api/projects/${code}/field`, user?.id, { method: "PUT", body: JSON.stringify(body) }).catch((e) => setError(`Not saved: ${e instanceof Error ? e.message : e}`)),
    [code, user?.id],
  );

  /** Same shape as a state setter; only the items that changed are sent to the server. */
  const setItems = useCallback(
    (next: FieldItem[] | ((all: FieldItem[]) => FieldItem[])) => {
      const before = new Map(current.current.map((i) => [i.id, JSON.stringify(i)]));
      const value = typeof next === "function" ? next(current.current) : next;
      current.current = value;
      setItemsState(value);
      const changed = value.filter((i) => before.get(i.id) !== JSON.stringify(i));
      if (changed.length) void save({ items: changed });
    },
    [save],
  );

  const setStock = useCallback(
    (next: Stock | ((s: Stock) => Stock)) => {
      const value = typeof next === "function" ? next(currentStock.current) : next;
      currentStock.current = value;
      setStockState(value);
      void save({ stock: value });
    },
    [save],
  );

  const reset = useCallback(async () => {
    await call(`/api/projects/${code}/reset`, user?.id, { method: "POST" }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    await reload();
  }, [code, user?.id, reload]);

  return { items, setItems, stock, setStock, status, error, reload, reset };
}

export type SyncResult = { fetched: number; new: number; duplicate: number; skipped: number; reasons: string[] };

export function useSubmissions(code = "A-2027") {
  const { user, ready } = useSession();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [roster, setRoster] = useState<Roster>({});
  const [status, setStatus] = useState<Load>("loading");
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const r = await call<{ submissions: Submission[]; roster: Roster }>(`/api/projects/${code}/submissions`, user?.id);
      setSubmissions(r.submissions);
      setRoster(r.roster);
      setStatus("ready");
      setError("");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [code, user?.id]);

  useEffect(() => {
    if (ready && user) void reload();
  }, [ready, user, reload]);

  /** MEL accept or query. Returns the server's summary of what changed in Field activities. */
  const decide = useCallback(
    async (dbIds: string[], status: "accepted" | "queried", note?: string) => {
      const out: string[] = [];
      for (const id of dbIds) {
        const r = await call<{ applied: string | null; already: string | null }>(`/api/projects/${code}/submissions/${id}`, user?.id, {
          method: "POST",
          body: JSON.stringify({ status, note }),
        });
        if (r.applied) out.push(r.applied);
      }
      await reload();
      return out;
    },
    [code, user?.id, reload],
  );

  const sync = useCallback(async () => {
    const r = await call<SyncResult>("/api/kobo/sync", user?.id, { method: "POST" });
    await reload();
    return r;
  }, [user?.id, reload]);

  const pushFarmers = useCallback(
    () => call<{ farmers: number; redeployed: boolean }>(`/api/kobo/push-farmers?project=${code}`, user?.id, { method: "POST" }),
    [code, user?.id],
  );

  return { submissions, roster, status, error, reload, decide, sync, pushFarmers };
}
