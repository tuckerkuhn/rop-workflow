"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, SectionLabel, TopBar, dangerBtn, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { CATEGORIES, CATEGORY_KEYS, FIRST_LAST_DAY, MILEAGE_RATE, amountOf, perDiemOf, summary, type Category, type ExAction, type ExpenseLine, type Receipt, type Report } from "@/lib/expense";
import type { ExpenseView } from "@/app/api/expenses/route";

/**
 * Expense reports: a line per expense with its receipt photo, per diem and mileage worked out,
 * signed by the supervisor and Finance, then reimbursed in the next payroll.
 */

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

const money = (n: number, cur: string) => (cur === "AFN" ? `${Math.round(n).toLocaleString("en-US")} AFN` : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const draftKey = (person: string, month: string) => `rop-ex-${person}-${month}`;
const readDraft = (k: string): Report | null => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as Report) : null;
  } catch {
    return null;
  }
};
const writeDraft = (k: string, r: Report | null) => {
  try {
    if (r) localStorage.setItem(k, JSON.stringify(r));
    else localStorage.removeItem(k);
  } catch {}
};

/** Photos are shrunk in the browser (longest side 1600 px, JPEG), so they upload quickly on a weak connection. */
export async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 400_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

/** Opens a receipt; in the demo the person is sent as a header, so it is fetched first. */
export async function openReceipt(hash: string, user: string | undefined) {
  const res = await fetch(`/api/files/${hash}`, { headers: { "x-demo-user": user ?? "" } });
  if (!res.ok) return;
  const url = URL.createObjectURL(await res.blob());
  window.open(url, "_blank", "noopener");
}

const STATUS: Record<string, { tone: "forest" | "ochre" | "clay" | "muted" | "sky"; text: string }> = {
  pending: { tone: "ochre", text: "Waiting for the supervisor" },
  approved: { tone: "sky", text: "Waiting for Finance" },
  accepted: { tone: "forest", text: "Accepted" },
  returned: { tone: "clay", text: "Sent back" },
  withdrawn: { tone: "muted", text: "Withdrawn" },
};

export function ExpensePage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { date } = useT();
  const [v, setV] = useState<ExpenseView | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [init, setInit] = useState(false);
  // Finance entering a paper claim for someone else.
  const [onBehalf, setOnBehalf] = useState<{ id: string; name: string; currency: string } | null>(null);
  const [paperFor, setPaperFor] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("open")) setOpen(Number(q.get("open")));
    setInit(true);
  }, []);
  const load = useCallback(async () => {
    if (!user) return;
    try {
      setV(await call<ExpenseView>(`/api/expenses${open ? `?open=${open}` : ""}`, user.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user, open]);
  useEffect(() => {
    if (init && ready && user) void load();
  }, [init, ready, user, load]);
  useEffect(() => {
    if (editing && user) writeDraft(draftKey(onBehalf?.id ?? user.id, editing.month), editing);
  }, [editing, user, onBehalf]);

  if (!user) return null;
  const monthName = (m: string) => date(`${m}-01`, { month: "long", year: "numeric" });
  const act = async (a: ExAction, msg: string) => {
    setError("");
    try {
      const r = await call<{ n: number; view: ExpenseView }>("/api/expenses", user.id, { method: "POST", body: JSON.stringify(a) });
      if (a.action === "submit") {
        writeDraft(draftKey(a.person ?? user.id, a.report.month), null);
        setEditing(null);
        setOnBehalf(null);
        setOpen(r.n);
      }
      setV(r.view);
      setNotice(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const startReport = (month: string, from?: Report, forPerson?: { id: string; name: string; currency: string }) => {
    setOpen(null);
    setNotice("");
    setOnBehalf(forPerson ?? null);
    const currency = (forPerson?.currency ?? v?.currency ?? "USD") as "USD" | "AFN";
    setEditing(readDraft(draftKey(forPerson?.id ?? user.id, month)) ?? from ?? { month, currency, lines: [] });
  };
  const show = (n: number) => {
    setEditing(null);
    setNotice("");
    setOpen(n);
    history.replaceState(null, "", `/expenses?open=${n}`);
  };
  const thisMonth = v?.today.slice(0, 7) ?? "";
  const lastMonth = thisMonth ? new Date(Date.UTC(Number(thisMonth.slice(0, 4)), Number(thisMonth.slice(5)) - 2, 1)).toISOString().slice(0, 7) : "";

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl tracking-tight">Expenses</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted">One report a month. Photograph each receipt; per diem and mileage are worked out. Your supervisor approves, Finance checks, and payroll reimburses you.</p>
          </div>
          <Link href="/people" className="text-sm font-semibold text-forest hover:underline">
            People
          </Link>
        </div>
        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 rounded-xl bg-mist px-4 py-3 text-sm text-leaf">
            {notice}
          </p>
        )}
        {!v ? (
          !error && <p className="mt-10 text-sm text-muted">Loading…</p>
        ) : editing ? (
          <Editor
            v={v}
            report={editing}
            setReport={setEditing}
            monthName={monthName}
            forName={onBehalf?.name}
            onCancel={() => {
              setEditing(null);
              setOnBehalf(null);
            }}
            onSubmit={() =>
              act({ action: "submit", report: editing, certify: true, ...(onBehalf ? { person: onBehalf.id } : {}) }, onBehalf ? `Entered for ${onBehalf.name}; it goes to their supervisor.` : "Sent to your supervisor.")
            }
          />
        ) : v.open ? (
          <Detail
            v={v}
            monthName={monthName}
            back={() => {
              setOpen(null);
              history.replaceState(null, "", "/expenses");
            }}
            act={act}
            revise={(r) => startReport(r.month, r)}
          />
        ) : (
          <>
            {v.waiting.length > 0 && <List title="Waiting for your signature" items={v.waiting} v={v} monthName={monthName} onOpen={show} highlight />}
            {v.paperPeople.length > 0 && (
              <section className="mt-6 rounded-2xl border border-line bg-surface p-4">
                <SectionLabel>Enter a paper claim</SectionLabel>
                <p className="mt-1 text-sm text-muted">For someone who filled in a paper claim and signed it. Scan the signed claim; it is attached to the report. Another finance officer accepts it for payment, not you.</p>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <select value={paperFor} onChange={(e) => setPaperFor(e.target.value)} className="rounded-xl border border-line bg-paper px-3 py-2.5 text-sm" aria-label="Whose claim">
                    <option value="">Whose claim…</option>
                    {v.paperPeople.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {[thisMonth, lastMonth].map((m) => (
                    <button key={m} type="button" disabled={!paperFor} className={quietBtn} onClick={() => startReport(m, undefined, v.paperPeople.find((p) => p.id === paperFor))}>
                      {monthName(m)}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {v.hasRecord && (
              <section className="mt-6 flex flex-wrap gap-2">
                {[thisMonth, lastMonth]
                  .filter((m) => !v.mine.some((r) => r.month === m && r.status !== "returned" && r.status !== "withdrawn"))
                  .map((m) => (
                    <button key={m} type="button" className={m === thisMonth ? primaryBtn : quietBtn} onClick={() => startReport(m)}>
                      New report for {monthName(m)}
                    </button>
                  ))}
              </section>
            )}
            {v.mine.length > 0 && <List title="Your reports" items={v.mine} v={v} monthName={monthName} onOpen={show} />}
            {v.owed.length > 0 && <List title="Accepted, to be paid in the next payroll" items={v.owed} v={v} monthName={monthName} onOpen={show} />}
            {v.others.length > 0 && <List title={v.seesAll ? "Everyone's reports" : "Your team's reports"} items={v.others} v={v} monthName={monthName} onOpen={show} />}
            {!v.hasRecord && !v.waiting.length && !v.others.length && <p className="mt-8 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">You have no HR record yet, so expenses cannot be paid to you.</p>}
          </>
        )}
      </main>
    </div>
  );
}

function List({ title, items, v, monthName, onOpen, highlight }: { title: string; items: ExpenseView["mine"]; v: ExpenseView; monthName: (m: string) => string; onOpen: (n: number) => void; highlight?: boolean }) {
  return (
    <section className="mt-6">
      <SectionLabel>{title}</SectionLabel>
      <ul className={`mt-2 divide-y divide-line rounded-2xl border bg-surface ${highlight ? "border-forest/40" : "border-line"}`}>
        {items.map((r) => (
          <li key={r.n}>
            <button type="button" onClick={() => onOpen(r.n)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-start text-sm hover:bg-sunken">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{r.person === v.me ? monthName(r.month) : `${v.names[r.person] ?? r.person} · ${monthName(r.month)}`}</span>
                <span className="block text-xs text-muted">
                  {r.lines} {r.lines === 1 ? "expense" : "expenses"}
                  {r.version > 1 ? ` · version ${r.version}` : ""}
                </span>
              </span>
              <span className="tabular-nums">{money(r.total, r.currency)}</span>
              {r.paid ? <Pill tone={r.paid.status === "approved" ? "forest" : "sky"}>{r.paid.status === "approved" ? `Paid, ${r.paid.month} payroll` : "In a payroll awaiting signatures"}</Pill> : <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].text}</Pill>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------- One report ---------------- */

function Detail({ v, monthName, back, act, revise }: { v: ExpenseView; monthName: (m: string) => string; back: () => void; act: (a: ExAction, msg: string) => Promise<void>; revise: (r: Report) => void }) {
  const r = v.open!;
  const { user } = useSession();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = (id: string) => v.sources.find((s) => s.id === id)?.label ?? id;
  const run = async (a: ExAction, msg: string) => {
    setBusy(true);
    try {
      await act(a, msg);
    } finally {
      setBusy(false);
    }
  };
  const name = (id: string) => v.names[id] ?? id;
  return (
    <section className="mt-6 space-y-4">
      <button type="button" onClick={back} className="text-sm font-semibold text-forest hover:underline">
        ← All reports
      </button>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold">
          {r.person === v.me ? "Your" : `${name(r.person)}'s`} expenses, {monthName(r.report.month)}
        </h2>
        {r.paid ? <Pill tone="forest">{r.paid.status === "approved" ? `Paid in the ${r.paid.month} payroll` : "In a payroll awaiting signatures"}</Pill> : <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].text}</Pill>}
      </div>
      <p className="text-sm text-muted">
        Version {r.version}, submitted {new Date(r.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
        {r.signatures.map((s) => ` · ${s.step === "supervisor" ? "approved" : "accepted by Finance"}: ${name(s.by)}`).join("")}
        {r.next && ` · next: ${r.next.people.map(name).join(" or ") || "nobody (check the HR rules)"}${r.next.via !== "supervisor" && r.next.via !== "Finance" ? ` (${r.next.via})` : ""}`}
      </p>
      {r.by !== r.person && (
        <p className="rounded-xl bg-sunken px-4 py-3 text-sm">
          Entered by {name(r.by)} (Finance) from {name(r.person)}&apos;s signed paper claim.{" "}
          {r.report.paperClaim && (
            <button type="button" onClick={() => void openReceipt(r.report.paperClaim!.hash, user?.id)} className="font-semibold text-forest hover:underline">
              📎 {r.report.paperClaim.name}
            </button>
          )}
        </p>
      )}
      {r.returned && <p className="rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">Sent back by {name(r.returned.by)}: “{r.returned.note}”</p>}
      {(r.canSign || v.seesAll) && r.flags.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-ochre-soft px-3 py-2 text-sm text-ochre">
          {r.flags.map((f) => (
            <li key={f}>⚠ {f}</li>
          ))}
        </ul>
      )}
      <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
        {r.report.lines.map((l, i) => (
          <li key={i} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="w-6 text-muted">{i + 1}</span>
              <span className="min-w-0 flex-1 font-medium">{l.description}</span>
              <span className="tabular-nums font-semibold">{money(amountOf(l), r.report.currency)}</span>
            </div>
            <p className="ms-9 text-xs text-muted">
              {l.date} · {CATEGORIES[l.category].label}
              {CATEGORIES[l.category].gl ? ` (GL ${CATEGORIES[l.category].gl})` : ""} · {label(l.source)}
              {l.perDiem && ` · ${l.perDiem.place}, ${l.perDiem.start} to ${l.perDiem.end} at ${l.perDiem.rate}/day`}
              {l.category === "mileage" && ` · ${l.miles} miles at ${MILEAGE_RATE}`}
            </p>
            <p className="ms-9 mt-1 flex flex-wrap gap-2 text-xs">
              {l.receipts.map((rc) => (
                <button key={rc.hash} type="button" onClick={() => void openReceipt(rc.hash, user?.id)} className="rounded-full border border-line px-2 py-0.5 hover:border-forest" title={`Fingerprint ${rc.hash}`}>
                  📎 {rc.name}
                </button>
              ))}
              {l.noReceipt && <span className="text-ochre">No receipt: {l.noReceipt}</span>}
            </p>
          </li>
        ))}
      </ul>
      <Totals report={r.report} v={v} />
      {r.cannotSign && <p className="text-sm text-muted">You cannot sign this: {r.cannotSign}.</p>}
      {note === null ? (
        <div className="flex flex-wrap gap-2">
          {r.canSign && (
            <>
              <button type="button" disabled={busy} className={primaryBtn} onClick={() => run({ action: "approve", report: r.n }, r.status === "pending" ? "Approved. It goes to Finance." : "Accepted. It will be paid in the next payroll.")}>
                {r.status === "pending" ? "Approve" : "Accept for payment"}
              </button>
              <button type="button" disabled={busy} className={quietBtn} onClick={() => setNote("")}>
                Send back
              </button>
            </>
          )}
          {r.canWithdraw && (
            <button type="button" disabled={busy} className={quietBtn} onClick={() => run({ action: "withdraw", report: r.n }, "Withdrawn.")}>
              Withdraw
            </button>
          )}
          {r.person === v.me && (r.status === "returned" || r.status === "withdrawn" || r.status === "pending") && (
            <button type="button" className={quietBtn} onClick={() => revise(r.report)}>
              {r.status === "returned" ? "Correct and resubmit" : "Edit and resubmit"}
            </button>
          )}
        </div>
      ) : (
        <div>
          <label className="text-sm font-medium" htmlFor="ex-back">
            What needs to change?
          </label>
          <textarea id="ex-back" value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-base" />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy || note.trim().length < 3} className={dangerBtn} onClick={() => run({ action: "return", report: r.n, note }, "Sent back with your note.").then(() => setNote(null))}>
              Send back
            </button>
            <button type="button" className={quietBtn} onClick={() => setNote(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Totals({ report, v }: { report: Report; v: ExpenseView }) {
  const s = useMemo(() => summary(report), [report]);
  const label = (id: string) => v.sources.find((x) => x.id === id)?.label ?? id;
  return (
    <div className="grid gap-3 rounded-2xl border border-line bg-surface p-4 text-sm sm:grid-cols-2">
      <div>
        <SectionLabel>By account</SectionLabel>
        <ul className="mt-2 space-y-0.5">
          {(Object.entries(s.byCategory) as [Category, number][]).map(([c, a]) => (
            <li key={c} className="flex justify-between gap-3">
              <span className="truncate">
                {CATEGORIES[c].gl ? `${CATEGORIES[c].gl} ` : ""}
                {CATEGORIES[c].label}
              </span>
              <span className="tabular-nums">{money(a, report.currency)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <SectionLabel>By funding source</SectionLabel>
        <ul className="mt-2 space-y-0.5">
          {Object.entries(s.bySource).map(([k, a]) => (
            <li key={k} className="flex justify-between gap-3">
              <span className="truncate">{label(k)}</span>
              <span className="tabular-nums">{money(a, report.currency)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 flex justify-between border-t border-line pt-2 font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{money(s.total, report.currency)}</span>
        </p>
      </div>
    </div>
  );
}

/* ---------------- Filling it in ---------------- */

const blank = (month: string, source: string): ExpenseLine => ({ date: `${month}-01`, category: "taxi", description: "", source, amount: undefined, receipts: [] });

function Editor({
  v,
  report,
  setReport,
  monthName,
  forName,
  onCancel,
  onSubmit,
}: {
  v: ExpenseView;
  report: Report;
  setReport: (r: Report) => void;
  monthName: (m: string) => string;
  forName?: string;
  onCancel: () => void;
  onSubmit: () => Promise<void>;
}) {
  const { user } = useSession();
  const [scanError, setScanError] = useState("");
  const [edit, setEdit] = useState<{ i: number | null; line: ExpenseLine } | null>(report.lines.length ? null : { i: null, line: blank(report.month, v.sources[0]?.id ?? "non-contract") });
  const [certify, setCertify] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = (line: ExpenseLine, i: number | null) => {
    const lines = [...report.lines];
    if (i === null) lines.push(line);
    else lines[i] = line;
    setReport({ ...report, lines });
    setEdit(null);
  };
  return (
    <section className="mt-6 space-y-4">
      <h2 className="text-xl font-semibold">
        {forName ? `${forName}'s expenses` : "Expenses"}, {monthName(report.month)}
      </h2>
      {forName && (
        <div className="rounded-2xl border border-ochre/50 bg-ochre-soft p-4 text-sm">
          <p className="font-semibold">The signed paper claim</p>
          <p className="mt-1 text-muted">Scan or photograph the claim as {forName} signed it. Enter each line exactly as on the paper, with its receipts.</p>
          <label className={`${quietBtn} mt-2 inline-block cursor-pointer`}>
            {report.paperClaim ? `📎 ${report.paperClaim.name}` : "Attach the signed claim"}
            <input
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setScanError("");
                try {
                  const body = new FormData();
                  body.append("file", await shrink(f));
                  setReport({ ...report, paperClaim: await call<Receipt>("/api/files", user?.id, { method: "POST", body }) });
                } catch (err) {
                  setScanError(err instanceof Error ? err.message : String(err));
                }
              }}
            />
          </label>
          {scanError && <p className="mt-1 text-clay">{scanError}</p>}
        </div>
      )}
      <p className="text-sm text-muted">In {report.currency}, the currency you are paid in. Unsent changes stay in this browser; receipts are saved as soon as they upload.</p>
      {report.lines.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {report.lines.map((l, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3 text-sm">
              <button type="button" onClick={() => setEdit({ i, line: l })} className="min-w-0 flex-1 text-start">
                <span className="block truncate font-medium">{l.description || CATEGORIES[l.category].label}</span>
                <span className="block text-xs text-muted">
                  {l.date} · {CATEGORIES[l.category].label} · {l.receipts.length ? `${l.receipts.length} receipt${l.receipts.length > 1 ? "s" : ""}` : l.category === "perDiem" || l.category === "mileage" ? "worked out" : "no receipt"}
                </span>
              </button>
              <span className="tabular-nums">{money(amountOf(l), report.currency)}</span>
              <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => setReport({ ...report, lines: report.lines.filter((_, j) => j !== i) })} className="grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-sunken">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {edit ? (
        <LineForm v={v} month={report.month} currency={report.currency} line={edit.line} onSave={(l) => save(l, edit.i)} onCancel={() => setEdit(null)} />
      ) : (
        <button type="button" className={quietBtn} onClick={() => setEdit({ i: null, line: blank(report.month, report.lines.at(-1)?.source ?? v.sources[0]?.id ?? "non-contract") })}>
          Add an expense
        </button>
      )}
      {report.lines.length > 0 && !edit && (
        <>
          <Totals report={report} v={v} />
          <label className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-sm">
            <input type="checkbox" checked={certify} onChange={(e) => setCertify(e.target.checked)} className="mt-0.5 h-5 w-5" />
            <span>
              {forName
                ? `Entered by Finance exactly as on ${forName}'s signed paper claim, attached; the original is kept on file.`
                : "I certify that these expenses were incurred for ROP work, are not claimed elsewhere, and the receipts are genuine."}
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!certify || busy || (!!forName && !report.paperClaim)}
              className={primaryBtn}
              onClick={async () => {
                setBusy(true);
                try {
                  await onSubmit();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Sending…" : "Submit"}
            </button>
            <button type="button" className={quietBtn} onClick={onCancel}>
              Close (keeps the draft)
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function LineForm({ v, month, currency, line, onSave, onCancel }: { v: ExpenseView; month: string; currency: string; line: ExpenseLine; onSave: (l: ExpenseLine) => void; onCancel: () => void }) {
  const { user } = useSession();
  const [l, setL] = useState<ExpenseLine>(line);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<ExpenseLine>) => setL((cur) => ({ ...cur, ...patch }));
  const input = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base";
  const isPerDiem = l.category === "perDiem";
  const isMiles = l.category === "mileage";
  const pd = l.perDiem ?? { place: "", rate: 0, start: `${month}-01`, end: `${month}-01` };
  const calc = isPerDiem ? perDiemOf(pd) : null;
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError("");
    try {
      const added: Receipt[] = [];
      for (const f of Array.from(files)) {
        const body = new FormData();
        body.append("file", await shrink(f));
        added.push(await call<Receipt>("/api/files", user?.id, { method: "POST", body }));
      }
      setL((cur) => ({ ...cur, receipts: [...cur.receipts, ...added].slice(0, 10) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };
  const problem =
    l.description.trim().length < 2
      ? "Say what it was."
      : isPerDiem
        ? !pd.place || !pd.rate || pd.end < pd.start
          ? "Enter the place, the daily rate and the travel dates."
          : null
        : isMiles
          ? !(l.miles ?? 0)
            ? "Enter the miles."
            : null
          : !(l.amount ?? 0)
            ? "Enter the amount."
            : !l.receipts.length && (l.noReceipt ?? "").trim().length < 5
              ? "Attach the receipt, or say why there is none."
              : null;
  return (
    <div className="space-y-3 rounded-2xl border border-forest/40 bg-paper p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">
          <span className="font-medium">What kind</span>
          <select value={l.category} onChange={(e) => set({ category: e.target.value as Category })} className={input}>
            {CATEGORY_KEYS.filter((c) => c !== "mileage" || currency === "USD").map((c) => (
              <option key={c} value={c}>
                {CATEGORIES[c].label}
                {CATEGORIES[c].gl ? ` (${CATEGORIES[c].gl})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="font-medium">What it was for</span>
          <input value={l.description} onChange={(e) => set({ description: e.target.value })} placeholder={isPerDiem ? "Field visit to Herat" : "Taxi to the Ministry of Agriculture"} className={input} />
        </label>
        {!isPerDiem && (
          <label className="text-sm">
            <span className="font-medium">Date</span>
            <input type="date" value={l.date} onChange={(e) => set({ date: e.target.value })} className={input} />
          </label>
        )}
        <label className="text-sm">
          <span className="font-medium">Funding source</span>
          <select value={l.source} onChange={(e) => set({ source: e.target.value })} className={input}>
            {v.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {isMiles ? (
          <label className="text-sm">
            <span className="font-medium">Miles driven</span>
            <input type="number" inputMode="decimal" min={0} value={l.miles ?? ""} onChange={(e) => set({ miles: e.target.value === "" ? undefined : Number(e.target.value) })} className={input} />
            <span className="mt-1 block text-xs text-muted">At ${MILEAGE_RATE} a mile: {money(amountOf(l), currency)}</span>
          </label>
        ) : (
          !isPerDiem && (
            <label className="text-sm">
              <span className="font-medium">Amount ({currency})</span>
              <input type="number" inputMode="decimal" min={0} step="0.01" value={l.amount ?? ""} onChange={(e) => set({ amount: e.target.value === "" ? undefined : Number(e.target.value) })} className={input} />
            </label>
          )
        )}
      </div>
      {isPerDiem && (
        <fieldset className="grid gap-3 rounded-xl bg-sunken p-3 sm:grid-cols-2">
          <legend className="sr-only">Per diem</legend>
          <label className="text-sm">
            <span className="font-medium">Place</span>
            <input value={pd.place} onChange={(e) => set({ perDiem: { ...pd, place: e.target.value } })} placeholder="Guatemala City" className={input} />
          </label>
          <label className="text-sm">
            <span className="font-medium">M&amp;IE rate per day ({currency})</span>
            <input type="number" inputMode="decimal" min={0} value={pd.rate || ""} onChange={(e) => set({ perDiem: { ...pd, rate: Number(e.target.value) || 0 } })} className={input} />
            <span className="mt-1 block text-xs text-muted">
              From the{" "}
              <a href="https://aoprals.state.gov/web920/per_diem.asp" target="_blank" rel="noreferrer" className="underline">
                State Department table
              </a>{" "}
              abroad, or{" "}
              <a href="https://www.gsa.gov/travel/plan-book/per-diem-rates" target="_blank" rel="noreferrer" className="underline">
                GSA
              </a>{" "}
              in the US.
            </span>
          </label>
          <label className="text-sm">
            <span className="font-medium">Left on</span>
            <input type="date" value={pd.start} onChange={(e) => set({ perDiem: { ...pd, start: e.target.value }, date: e.target.value })} className={input} />
          </label>
          <label className="text-sm">
            <span className="font-medium">Back on</span>
            <input type="date" value={pd.end} min={pd.start} onChange={(e) => set({ perDiem: { ...pd, end: e.target.value } })} className={input} />
          </label>
          {calc && calc.days > 0 && (
            <p className="text-sm sm:col-span-2">
              {calc.partial} travel {calc.partial === 1 ? "day" : "days"} at {FIRST_LAST_DAY * 100}% and {calc.full} full {calc.full === 1 ? "day" : "days"}: <span className="font-semibold">{money(calc.amount, currency)}</span>
            </p>
          )}
        </fieldset>
      )}
      {!isPerDiem && !isMiles && (
        <div className="text-sm">
          <span className="font-medium">Receipt</span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {l.receipts.map((rc) => (
              <span key={rc.hash} className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs">
                📎 {rc.name}
                <button type="button" aria-label={`Remove ${rc.name}`} onClick={() => set({ receipts: l.receipts.filter((x) => x.hash !== rc.hash) })} className="text-muted">
                  ×
                </button>
              </span>
            ))}
            <label className={`${quietBtn} cursor-pointer`}>
              {uploading ? "Uploading…" : "Photo or PDF"}
              <input type="file" accept="image/*,application/pdf" capture="environment" multiple className="sr-only" disabled={uploading} onChange={(e) => void upload(e.target.files)} />
            </label>
          </div>
          {!l.receipts.length && (
            <label className="mt-2 block">
              <span className="text-xs text-muted">No receipt? Say why</span>
              <input value={l.noReceipt ?? ""} onChange={(e) => set({ noReceipt: e.target.value || undefined })} placeholder="For example: shared taxi, no receipt given" className={input} />
            </label>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-clay">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={primaryBtn} disabled={!!problem || uploading} onClick={() => onSave({ ...l, ...(isPerDiem ? { perDiem: pd, date: pd.start, amount: undefined, miles: undefined, receipts: [] } : isMiles ? { amount: undefined, perDiem: undefined, receipts: [] } : { perDiem: undefined, miles: undefined }) })}>
          Save expense
        </button>
        <button type="button" className={quietBtn} onClick={onCancel}>
          Cancel
        </button>
        {problem && <span className="text-xs text-muted">{problem}</span>}
      </div>
    </div>
  );
}
