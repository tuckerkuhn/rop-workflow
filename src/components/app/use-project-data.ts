"use client";

import { trackSave } from "@/components/app/saving-sign";
import { OFFLINE, plainError } from "@/lib/plain-error";
import type { VoucherSetup } from "@/lib/voucher-setup";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/components/app/session";
import type { FieldItem, Stock } from "@/lib/field";
import type { FieldSetup } from "@/lib/package";
import type { Shown } from "@/lib/selection";
import type { Procurement } from "@/lib/procurement";
import type { Closeouts } from "@/lib/closeout";
import type { AskInput, PlanAction, PlanItem } from "@/lib/procurement-plan";
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
  // A request that never reached the server (no signal) says so, not "Failed to fetch".
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user ?? "", ...(init?.headers ?? {}) } }).catch(() => {
    throw new Error(OFFLINE);
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
  return body as T;
}

/** `wanted`: false on a screen that turns out not to use it (Home for staff on a database project), so nothing is requested. */
export function useFieldData(code = "A-2027", wanted = true) {
  const { user, ready } = useSession();
  const [items, setItemsState] = useState<FieldItem[]>([]);
  const [stock, setStockState] = useState<Stock>({});
  const [setup, setSetup] = useState<FieldSetup | null>(null);
  const [stockNote, setStockNote] = useState<string | null>(null);
  /** Each decided farmer's selection outcome (lib/selection Shown), or null when the project does not use selection. */
  const [selection, setSelection] = useState<Record<string, Shown> | null>(null);
  const [status, setStatus] = useState<Load>("loading");
  const [error, setError] = useState("");
  const current = useRef<FieldItem[]>([]);
  // The saved version of each record as this page last read or wrote it. Sent with every save, so
  // a change made while an earlier save was on its way is not mistaken for a stale copy.
  const revs = useRef<Map<string, string>>(new Map());
  const currentStock = useRef<Stock>({});

  // A load that comes back after a later load or save started is older than the screen: dropped.
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const r = await call<{ items: FieldItem[]; stock: Stock | null; stockNote?: string | null; setup?: FieldSetup | null; selection?: Record<string, Shown> | null }>(`/api/projects/${code}/field`, user?.id);
      if (mine !== seq.current) return;
      setStockNote(r.stockNote ?? null);
      setSelection(r.selection ?? null);
      setSetup(r.setup ?? null);
      current.current = r.items;
      revs.current = new Map(r.items.map((i) => [i.id, i.rev ?? ""]));
      setItemsState(r.items);
      currentStock.current = r.stock ?? {};
      setStockState(r.stock ?? {});
      setStatus("ready");
      setError("");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [code, user?.id]);

  useEffect(() => {
    if (wanted && ready && user) void reload();
  }, [wanted, ready, user, reload]);

  // Saves go one after another, each sending the latest copy with the version it is based on, so
  // two quick changes to one farmer never trip over each other.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const save = useCallback(
    (body: { ids?: string[]; stock?: Stock }) => {
      queue.current = trackSave(queue.current.then(async () => {
        const items = body.ids ? current.current.filter((i) => body.ids!.includes(i.id)).map((i) => ({ ...i, rev: revs.current.get(i.id) || undefined })) : undefined;
        if (body.ids && !items?.length) return;
        seq.current++;
        try {
          const r = await call<{ revs?: Record<string, string>; distributions?: string[]; planted?: number; stock?: Stock; stockNote?: string | null }>(`/api/projects/${code}/field`, user?.id, { method: "PUT", body: JSON.stringify({ items, stock: body.stock }) });
          for (const [id, rev] of Object.entries(r.revs ?? {})) revs.current.set(id, rev);
          // A distribution was recorded: the server kept the farmer at "distribute", waiting for
          // the project manager, so show what it saved.
          // Planting recorded toward a target: the server noted on the farmer whether it counted.
          if (r.distributions?.length || r.planted) {
            await reload();
            return;
          }
          // The store's stock comes from the purchases: after a save that moved a farmer, show the server's figure.
          if (items && r.stock) {
            setStockNote(r.stockNote ?? null);
            currentStock.current = r.stock;
            setStockState(r.stock);
          }
        } catch (e) {
          // Refused (a stale copy, a step not yours, inputs before the goods received note is
          // signed): show why and put the screen back to what is saved.
          await reload();
          setError(`Not saved: ${e instanceof Error ? e.message : e}`);
        }
      }));
      return queue.current;
    },
    [code, user?.id, reload],
  );

  /** Same shape as a state setter; only the items that changed are sent to the server. */
  const setItems = useCallback(
    (next: FieldItem[] | ((all: FieldItem[]) => FieldItem[])) => {
      const before = new Map(current.current.map((i) => [i.id, JSON.stringify(i)]));
      const steps = new Map(current.current.map((i) => [i.id, i.step]));
      const value = typeof next === "function" ? next(current.current) : next;
      current.current = value;
      // Recording a distribution sends the farmer on to planting, but the server keeps them at
      // Distribute until the project manager approves (server/distribution). Show that at once,
      // not planting, while the save and the reload after it are on their way.
      const held = (i: FieldItem): FieldItem =>
        i.kind === "farmer" && steps.get(i.id) === "distribute" && i.step === "plant" && !i.awaiting ? { ...i, step: "distribute", awaiting: { id: "", status: "pending" } } : i;
      setItemsState(value.map(held));
      const changed = value.filter((i) => before.get(i.id) !== JSON.stringify(i)).map((i) => i.id);
      if (changed.length) void save({ ids: changed });
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

  return { items, setItems, stock, stockNote, setStock, setup, selection, status, error, reload, reset };
}


/** The project's procurements, shared through the database. Same shape as a state setter; only changed records are sent. */
export function useProcurements(code = "A-2027", wanted = true) {
  const { user, ready } = useSession();
  const [items, setItemsState] = useState<Procurement[]>([]);
  /** Budget lines of the Field input package: their goods go out through Field activities. */
  const [packageLines, setPackageLines] = useState<string[]>([]);
  const [coding, setCoding] = useState<VoucherSetup | null>(null);
  const [status, setStatus] = useState<Load>("loading");
  const [error, setError] = useState("");
  const current = useRef<Procurement[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = useRef<{ snap: Procurement[] }[]>([]);
  // Each load and save gets a number; a load that comes back after a later load or save started is
  // older than what is on screen and is dropped (on a slow connection they can finish out of order).
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const r = await call<{ items: Procurement[]; packageLines?: string[]; coding?: VoucherSetup }>(`/api/projects/${code}/procurements`, user?.id);
      if (mine !== seq.current) return;
      current.current = r.items;
      setItemsState(r.items);
      setPackageLines(r.packageLines ?? []);
      setCoding(r.coding ?? null);
      setStatus("ready");
      setError("");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [code, user?.id]);

  // People without Procurement access (donors) never load it.
  useEffect(() => {
    if (wanted && ready && user && user.procurementAccess !== "none") void reload();
  }, [wanted, ready, user, reload]);

  const setItems = useCallback(
    (next: Procurement[] | ((all: Procurement[]) => Procurement[])) => {
      const before = new Map(current.current.map((p) => [p.id, JSON.stringify(p)]));
      const stepBefore = new Map(current.current.map((p) => [p.id, p.step]));
      const value = typeof next === "function" ? next(current.current) : next;
      current.current = value;
      setItemsState(value);
      const changed = value.filter((p) => before.get(p.id) !== JSON.stringify(p)).map((p) => p.id);
      if (!changed.length) return;
      // Saves go one after another, each sending the record as this change left it, so a step moved on
      // never reaches the server ahead of the fields it depends on. Typing at the same step is merged:
      // a save still waiting is skipped when a later one of the same records, at the same steps, follows.
      const snap = value.filter((p) => changed.includes(p.id));
      // A save that moves a step on is never skipped: a later save at the new step (a box ticked
      // there while this one was still on its way) would otherwise carry the move and the new step's
      // checks together, which the server rightly refuses.
      const moves = snap.some((p) => stepBefore.has(p.id) && stepBefore.get(p.id) !== p.step);
      const entry = { snap };
      pendingSaves.current.push(entry);
      queue.current = trackSave(queue.current.then(async () => {
        pendingSaves.current.splice(pendingSaves.current.indexOf(entry), 1);
        const sameRecords = (later: Procurement[]) => later.length === snap.length && later.every((x) => snap.some((y) => y.id === x.id && y.step === x.step));
        if (!moves && pendingSaves.current.some((e) => sameRecords(e.snap))) return;
        const revs = new Map(current.current.map((p) => [p.id, p.rev]));
        // An AI check or draft may have come back since this change was made: keep what it wrote
        // (findings, and any draft this copy does not have yet) rather than sending the older copy.
        const latest = new Map(current.current.map((p) => [p.id, p]));
        const send = snap.map((p) => {
          const now = latest.get(p.id);
          return { ...p, rev: revs.get(p.id) ?? p.rev, ...(now ? { ai: now.ai, drafts: now.drafts || p.drafts ? { ...now.drafts, ...p.drafts } : undefined } : {}) };
        });
        if (!send.length) return;
        seq.current++;
        try {
          const r = await call<{ revs: Record<string, number> }>(`/api/projects/${code}/procurements`, user?.id, { method: "PUT", body: JSON.stringify({ items: send }) });
          current.current = current.current.map((p) => (r.revs[p.id] !== undefined ? { ...p, rev: r.revs[p.id] } : p));
          setItemsState(current.current);
        } catch (e) {
          // A stale copy, or a refusal: show what is actually saved, and keep the reason on screen
          // (the reload clears errors, so it is set after).
          await reload();
          setError(`Not saved: ${e instanceof Error ? e.message : e}`);
        }
      }));
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

  return { items, packageLines, coding, setItems, status, error, reload, reset, draft, check };
}

/** The procurement calendar of a project, with the budget and workplan behind it. */
export function usePlan(code: string | null) {
  const { user, ready } = useSession();
  const [data, setData] = useState<{ items: PlanItem[]; budget: Budget; workplan: WorkplanItem[]; /** Unpaid commitments of purchases under way, by budget line, in the budget's currency. */ committed?: Record<string, number> } | null>(null);
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

  /** Asks for a purchase that is not on the calendar. Throws the server's reason when refused. */
  const ask = useCallback(
    async (input: AskInput) => {
      const r = await call<{ item: PlanItem }>(`/api/projects/${code}/procurement-plan/ask`, user?.id, { method: "POST", body: JSON.stringify(input) });
      await reload();
      return r.item;
    },
    [code, user?.id, reload],
  );

  /** Marks budget lines to buy through procurement (or not), then reloads. */
  const markProcure = useCallback(
    async (procure: Record<string, boolean>) => {
      await call(`/api/projects/${code}/budget`, user?.id, { method: "PATCH", body: JSON.stringify({ procure }) });
      await reload();
    },
    [code, user?.id, reload],
  );

  return { items: data?.items ?? [], budget: data?.budget ?? null, workplan: data?.workplan ?? [], committed: data?.committed ?? {}, status, error, reload, rebuild, act, ask, markProcure };
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

export function useSubmissions(code = "A-2027", wanted = true) {
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
    if (wanted && ready && user) void reload();
  }, [wanted, ready, user, reload]);

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

  /** A farmer left open on an accepted session record, held in Farmer selection: record them now, or leave them out. */
  const settleHeld = useCallback(
    async (dbId: string, farmer: string, action: "record" | "leave_out") => {
      const r = await call<{ applied: string | null }>(`/api/projects/${code}/submissions/${dbId}`, user?.id, { method: "POST", body: JSON.stringify({ held: farmer, action }) });
      await reload();
      return r.applied ?? "";
    },
    [code, user?.id, reload],
  );

  return { submissions, roster, status, error, reload, decide, settleHeld };
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

  /** `keepalive`: the request outlives the page, for a delete carried out as the tab closes. */
  const remove = useCallback(
    async (id: string, opts?: { keepalive?: boolean }) => {
      await call(`/api/projects/${code}/work-items/${id}`, user?.id, { method: "DELETE", keepalive: opts?.keepalive });
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

