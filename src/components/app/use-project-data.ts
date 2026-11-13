"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/components/app/session";
import { seedStock, type FieldItem, type Stock } from "@/lib/field";
import type { AutoSyncSecret, FormPurpose, KoboFormInfo, KoboMapping, KoboQuestion, KoboState, SyncCounts } from "@/lib/kobo-setup";
import type { Procurement } from "@/lib/procurement";
import type { Closeouts } from "@/lib/closeout";
import type { PlanAction, PlanItem } from "@/lib/procurement-plan";
import type { Budget, WorkplanItem } from "@/lib/budget";
import type { DonorInfo, DonorInput, ProgressData } from "@/lib/progress";
import type { Roster, Submission } from "@/lib/project";
import type { NewWorkItem, WorkItem } from "@/lib/work-items";

/**
 * Field activities, the review queue, tasks and milestones, and progress, read from and saved to the database through the API.
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
      call(`/api/projects/${code}/field`, user?.id, { method: "PUT", body: JSON.stringify(body) }).catch(async (e) => {
        // Refused (e.g. inputs handed out before the goods received note is signed): show why and
        // put the screen back to what is saved.
        await reload();
        setError(`Not saved: ${e instanceof Error ? e.message : e}`);
      }),
    [code, user?.id, reload],
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


/** The project's procurements, shared through the database. Same shape as a state setter; only changed records are sent. */
export function useProcurements(code = "A-2027") {
  const { user, ready } = useSession();
  const [items, setItemsState] = useState<Procurement[]>([]);
  const [status, setStatus] = useState<Load>("loading");
  const [error, setError] = useState("");
  const current = useRef<Procurement[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const reload = useCallback(async () => {
    try {
      const r = await call<{ items: Procurement[] }>(`/api/projects/${code}/procurements`, user?.id);
      current.current = r.items;
      setItemsState(r.items);
      setStatus("ready");
      setError("");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [code, user?.id]);

  // People without Procurement access (donors) never load it.
  useEffect(() => {
    if (ready && user && user.procurementAccess !== "none") void reload();
  }, [ready, user, reload]);

  const setItems = useCallback(
    (next: Procurement[] | ((all: Procurement[]) => Procurement[])) => {
      const before = new Map(current.current.map((p) => [p.id, JSON.stringify(p)]));
      const value = typeof next === "function" ? next(current.current) : next;
      current.current = value;
      setItemsState(value);
      const changed = value.filter((p) => before.get(p.id) !== JSON.stringify(p)).map((p) => p.id);
      if (!changed.length) return;
      // Saves go one after another, each sending the latest copy with the version it is based on.
      queue.current = queue.current.then(async () => {
        const send = current.current.filter((p) => changed.includes(p.id));
        if (!send.length) return;
        try {
          const r = await call<{ revs: Record<string, number> }>(`/api/projects/${code}/procurements`, user?.id, { method: "PUT", body: JSON.stringify({ items: send }) });
          current.current = current.current.map((p) => (r.revs[p.id] !== undefined ? { ...p, rev: r.revs[p.id] } : p));
          setItemsState(current.current);
        } catch (e) {
          setError(`Not saved: ${e instanceof Error ? e.message : e}`);
          // A stale copy, or a refusal: show what is actually saved.
          await reload();
        }
      });
    },
    [code, user?.id, reload],
  );

  /** Drafts a document with AI on the server; the saved record comes back with the draft on it. */
  const draft = useCallback(
    async (id: string, kind: "rfq" | "solicitation" | "sole" | "package") => {
      const r = await call<{ item: Procurement }>(`/api/projects/${code}/procurements/${id}/draft`, user?.id, { method: "POST", body: JSON.stringify({ kind }) });
      current.current = current.current.map((p) => (p.id === id ? r.item : p));
      setItemsState(current.current);
      return r.item;
    },
    [code, user?.id],
  );

  /** Runs the AI check for the procurement's current step; the findings come back saved on the record. */
  const check = useCallback(
    async (id: string, step: string) => {
      const r = await call<{ item: Procurement }>(`/api/projects/${code}/procurements/${id}/check`, user?.id, { method: "POST", body: JSON.stringify({ step }) });
      current.current = current.current.map((p) => (p.id === id ? r.item : p));
      setItemsState(current.current);
      return r.item;
    },
    [code, user?.id],
  );

  /** Demo mode only: restores all the project's sample records, procurements included. */
  const reset = useCallback(async () => {
    await call(`/api/projects/${code}/reset`, user?.id, { method: "POST" }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    await reload();
  }, [code, user?.id, reload]);

  return { items, setItems, status, error, reload, reset, draft, check };
}

/** The procurement calendar of a project, with the budget and workplan behind it. */
export function usePlan(code: string | null) {
  const { user, ready } = useSession();
  const [data, setData] = useState<{ items: PlanItem[]; budget: Budget; workplan: WorkplanItem[] } | null>(null);
  const [status, setStatus] = useState<Load>("loading");
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!code) return;
    try {
      setData(await call(`/api/projects/${code}/procurement-plan`, user?.id));
      setStatus("ready");
      setError("");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [code, user?.id]);

  useEffect(() => {
    if (ready && user && user.kind === "employee" && user.procurementAccess !== "none") void reload();
  }, [ready, user, reload]);

  /** Builds or refreshes the calendar from the budget. */
  const rebuild = useCallback(async () => {
    const r = await call<{ added: number; removed: number; total: number }>(`/api/projects/${code}/procurement-plan`, user?.id, { method: "POST" });
    await reload();
    return r;
  }, [code, user?.id, reload]);

  /** Approve, send back, reopen or change one item. Throws the server's reason when refused. */
  const act = useCallback(
    async (key: string, action: PlanAction) => {
      const r = await call<{ item: PlanItem }>(`/api/projects/${code}/procurement-plan/${key}`, user?.id, { method: "POST", body: JSON.stringify(action) });
      setData((d) => d && { ...d, items: d.items.map((i) => (i.key === key ? r.item : i)).sort((a, b) => a.startBy.localeCompare(b.startBy) || a.key.localeCompare(b.key)) });
      return r.item;
    },
    [code, user?.id],
  );

  return { items: data?.items ?? [], budget: data?.budget ?? null, workplan: data?.workplan ?? [], status, error, reload, rebuild, act };
}

/** Months closed by Finance, and closing one. */
export function useCloseouts(code: string | null) {
  const { user, ready } = useSession();
  const [months, setMonths] = useState<Closeouts>({});
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!code) return;
    try {
      setMonths((await call<{ months: Closeouts }>(`/api/projects/${code}/closeout`, user?.id)).months);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [code, user?.id]);
  useEffect(() => {
    if (ready && user && user.kind === "employee" && user.procurementAccess !== "none") void reload();
  }, [ready, user, reload]);
  const close = useCallback(
    async (month: string) => {
      setMonths((await call<{ months: Closeouts }>(`/api/projects/${code}/closeout`, user?.id, { method: "POST", body: JSON.stringify({ month }) })).months);
    },
    [code, user?.id],
  );
  return { months, error, close, reload };
}

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
    // The project's own Kobo link: readiness forms land in this queue, data forms count on Progress.
    const r = await call<SyncCounts>(`/api/projects/${code}/kobo/sync`, user?.id, { method: "POST" });
    await reload();
    return r;
  }, [code, user?.id, reload]);

  const pushFarmers = useCallback(
    () => call<{ farmers: number; forms: number; redeployed: boolean }>(`/api/kobo/push-farmers?project=${code}`, user?.id, { method: "POST" }),
    [code, user?.id],
  );

  /** Saves farmers.csv. Fetched rather than linked so demo mode can send who is asking. */
  const downloadFarmers = useCallback(async () => {
    const res = await fetch(`/api/kobo/farmers?project=${code}`, { headers: { "x-demo-user": user?.id ?? "" } });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Download failed (${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: "farmers.csv" });
    a.click();
    URL.revokeObjectURL(url);
  }, [code, user?.id]);

  return { submissions, roster, status, error, reload, decide, sync, pushFarmers, downloadFarmers };
}

/** Tasks and milestones on a project. `saved` is false for demo projects kept only in this browser. */
export function useWorkItems(code: string) {
  const { user, ready } = useSession();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [saved, setSaved] = useState(true);
  const [status, setStatus] = useState<Load>("loading");
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const r = await call<{ saved: boolean; items: WorkItem[] }>(`/api/projects/${code}/work-items`, user?.id);
      setItems(r.items);
      setSaved(r.saved);
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

  /** Throws with the server's message so the form can show it. */
  const add = useCallback(
    async (item: NewWorkItem) => {
      const r = await call<{ item: WorkItem }>(`/api/projects/${code}/work-items`, user?.id, { method: "POST", body: JSON.stringify(item) });
      setItems((all) => [...all, r.item]);
    },
    [code, user?.id],
  );

  /** Ticks a task off at once and puts it back if the server refuses. */
  const setDone = useCallback(
    async (id: string, done: boolean) => {
      const flip = (d: boolean) => setItems((all) => all.map((i) => (i.id === id ? { ...i, doneAt: d ? new Date().toISOString() : null, doneBy: d ? (user?.id ?? null) : null } : i)));
      flip(done);
      try {
        await call(`/api/projects/${code}/work-items/${id}`, user?.id, { method: "PATCH", body: JSON.stringify({ done }) });
      } catch (e) {
        flip(!done);
        setError(`Not saved: ${e instanceof Error ? e.message : e}`);
      }
    },
    [code, user?.id],
  );

  const remove = useCallback(
    async (id: string) => {
      await call(`/api/projects/${code}/work-items/${id}`, user?.id, { method: "DELETE" });
      setItems((all) => all.filter((i) => i.id !== id));
    },
    [code, user?.id],
  );

  /** Saves the notes on a task or milestone; throws with the server's message. */
  const setNotes = useCallback(
    async (id: string, notes: string) => {
      const r = await call<{ item: WorkItem }>(`/api/projects/${code}/work-items/${id}`, user?.id, { method: "PATCH", body: JSON.stringify({ notes }) });
      setItems((all) => all.map((i) => (i.id === id ? r.item : i)));
    },
    [code, user?.id],
  );

  return { items, saved, status, error, reload, add, setDone, remove, setNotes };
}

/** Indicators with values worked out on the server, and the donors this person may see. */
export function useProgress(code: string) {
  const { user, ready } = useSession();
  const [data, setData] = useState<ProgressData | null>(null);
  const [status, setStatus] = useState<Load>("loading");
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      setData(await call<ProgressData>(`/api/projects/${code}/progress`, user?.id));
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

  /** Throws with the server's message so the form can show it. */
  const saveDonor = useCallback(
    async (id: string | null, input: DonorInput) => {
      await call(id ? `/api/projects/${code}/donors/${id}` : `/api/projects/${code}/donors`, user?.id, { method: id ? "PUT" : "POST", body: JSON.stringify(input) });
      await reload();
    },
    [code, user?.id, reload],
  );

  const deleteDonor = useCallback(
    async (id: string) => {
      await call(`/api/projects/${code}/donors/${id}`, user?.id, { method: "DELETE" });
      await reload();
    },
    [code, user?.id, reload],
  );

  return { data, status, error, reload, saveDonor, deleteDonor };
}

/** Just the donors, for screens that filter by donor without needing indicator values. */
export function useDonors(code: string) {
  const { user, ready } = useSession();
  const [donors, setDonors] = useState<DonorInfo[]>([]);
  useEffect(() => {
    if (!ready || !user) return;
    call<{ donors: DonorInfo[] }>(`/api/projects/${code}/donors`, user.id)
      .then((r) => setDonors(r.donors))
      .catch(() => setDonors([]));
  }, [code, ready, user]);
  return donors;
}

/** The project's KoboToolbox link. Every action throws with the server's message so screens can show it. */
/**
 * The KoboToolbox server this project collects on, for a plain link to it. Null code skips the request
 * (no field access, or a project kept in the browser only); without a connection it is the main server.
 */
export function useKoboServer(code: string | null) {
  const { user, ready } = useSession();
  const [server, setServer] = useState("https://kf.kobotoolbox.org");
  useEffect(() => {
    if (!code || !ready || !user) return;
    call<KoboState>(`/api/projects/${code}/kobo`, user.id)
      .then((s) => s.connection?.serverUrl && setServer(s.connection.serverUrl))
      .catch(() => {});
  }, [code, ready, user]);
  return server;
}

export function useKobo(code: string) {
  const { user, ready } = useSession();
  const [state, setState] = useState<KoboState | null>(null);
  const [error, setError] = useState("");
  const base = `/api/projects/${code}/kobo`;

  const reload = useCallback(async () => {
    try {
      setState(await call<KoboState>(base, user?.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [base, user?.id]);

  useEffect(() => {
    if (ready && user) void reload();
  }, [ready, user, reload]);

  const send = useCallback(<T,>(path: string, method: string, body?: unknown) => call<T>(`${base}${path}`, user?.id, { method, body: body === undefined ? undefined : JSON.stringify(body) }), [base, user?.id]);

  // Stable between renders, so screens can load in effects without looping.
  const actions = useMemo(
    () => ({
      connect: async (input: { serverUrl: string; token?: string; countOnly: "all" | "approved" }) => setState(await send<KoboState>("", "PUT", input)),
      disconnect: async () => {
        await send("", "DELETE");
        await reload();
      },
      liveForms: () => send<{ forms: KoboFormInfo[] }>("/forms", "GET").then((r) => r.forms),
      questions: (uid: string) => send<{ questions: KoboQuestion[] }>(`/forms/${encodeURIComponent(uid)}`, "GET").then((r) => r.questions),
      saveForms: async (forms: { uid: string; name: string; purpose: FormPurpose }[]) => {
        await send("/forms", "PUT", { forms });
        await reload();
      },
      saveMappings: async (mappings: KoboMapping[]) => setState(await send<KoboState>("/mappings", "PUT", { mappings })),
      sync: async () => {
        const r = await send<SyncCounts>("/sync", "POST");
        await reload();
        return r;
      },
      enableAutoSync: async () => {
        const r = await send<AutoSyncSecret>("/auto", "POST");
        await reload();
        return r;
      },
      disableAutoSync: async () => {
        await send("/auto", "DELETE");
        await reload();
      },
    }),
    [send, reload],
  );

  return { state, error, reload, ...actions };
}
