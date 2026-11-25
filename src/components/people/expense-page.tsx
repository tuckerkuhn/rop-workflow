"use client";

import { plainError } from "@/lib/plain-error";
import { photoFacts } from "@/lib/exif";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { TopBar, dangerBtn, primaryBtn, quietBtn, StatusPill } from "@/components/workspace/ui";
import { Empty, Fig, LedgerRow, LedgerTable, PageHead, SectionHead, Sheet, StatusBlock } from "@/components/workspace/ledger";
import { CATEGORIES, CATEGORY_KEYS, FIRST_LAST_DAY, MILEAGE_RATE, amountOf, mileageRateOf, perDiemOf, summary, type Category, type ExAction, type ExpenseLine, type Receipt, type Report } from "@/lib/expense";
import type { ExpenseView } from "@/app/api/expenses/route";
import type { MessageKey } from "@/lib/i18n";
import { NON_CONTRACT } from "@/lib/timesheet";

/**
 * Expense reports: a line per expense with its receipt photo, per diem and mileage worked out,
 * signed by the supervisor and Finance, then reimbursed in the next payroll.
 */

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
  return body as T;
}

/** A list of reports: who and when, the total, the status. On a phone the three stack and wrap. */
const LIST = "minmax(0,1fr) 9rem 15rem";
/** One report's lines: what it was for, then the amount at the right. */
const LINES = "2.25rem minmax(0,1fr) auto";

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

const STATUS: Record<string, { tone: "forest" | "ochre" | "clay" | "muted" | "sky"; text: MessageKey }> = {
  pending: { tone: "ochre", text: "exp.status.pending" },
  approved: { tone: "sky", text: "exp.status.approved" },
  accepted: { tone: "forest", text: "exp.status.accepted" },
  returned: { tone: "clay", text: "exp.status.returned" },
  withdrawn: { tone: "muted", text: "exp.status.withdrawn" },
};

const CAT_KEY: Record<Category, MessageKey> = {
  perDiem: "exp.cat.perDiem",
  airfareIntl: "exp.cat.airfareIntl",
  airfareUs: "exp.cat.airfareUs",
  parking: "exp.cat.parking",
  taxi: "exp.cat.taxi",
  mileage: "exp.cat.mileage",
  lodging: "exp.cat.lodging",
  meals: "exp.cat.meals",
  entertainment: "exp.cat.entertainment",
  supplies: "exp.cat.supplies",
  equipment: "exp.cat.equipment",
  maintenance: "exp.cat.maintenance",
  subscriptions: "exp.cat.subscriptions",
  other: "exp.cat.other",
};

/** Who signs next, when it is not the usual supervisor or Finance (text from src/lib/expense.ts). */
const VIA_KEY: Record<string, MessageKey> = {
  "HR (the supervisor has a conflict)": "exp.via.hr",
  "the CFO (Finance has a conflict)": "exp.via.cfo",
};

/** Funding source names; the general one is named here, projects keep their own names. */
function useSourceLabel(v: ExpenseView) {
  const { t } = useT();
  return (id: string) => (id === NON_CONTRACT ? t("exp.nonContract") : (v.sources.find((s) => s.id === id)?.label ?? id));
}

export function ExpensePage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { t, date } = useT();
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
        {/* HR roles go back to People; everyone else came from Home. */}
        <PageHead back={v?.seesAll ? { href: "/people", label: t("exp.people") } : { href: "/home", label: t("nav.home") }} title={t("exp.title")}>
          {t("exp.intro")}
        </PageHead>
        {error && (
          <p role="alert" className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 bg-mist px-4 py-3 text-sm text-leaf">
            {notice}
          </p>
        )}
        {!v ? (
          !error && <p className="mt-10 text-sm text-muted">{t("exp.loading")}</p>
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
              act({ action: "submit", report: editing, certify: true, ...(onBehalf ? { person: onBehalf.id } : {}) }, onBehalf ? t("exp.enteredFor", { name: onBehalf.name }) : t("exp.sentToSupervisor"))
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
            {v.waiting.length > 0 && <List title={t("exp.waitingYou")} items={v.waiting} v={v} monthName={monthName} onOpen={show} />}
            {v.paperPeople.length > 0 && (
              <section>
                <SectionHead>{t("exp.paperTitle")}</SectionHead>
                <Sheet className="mt-3">
                  <p className="text-sm text-muted">{t("exp.paperHelp")}</p>
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <select value={paperFor} onChange={(e) => setPaperFor(e.target.value)} className="min-h-11 border border-line bg-paper px-3 py-2.5 text-sm" aria-label={t("exp.whoseClaim")}>
                      <option value="">{t("exp.whoseClaimPick")}</option>
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
                </Sheet>
              </section>
            )}
            {v.hasRecord && (
              <section className="mt-8 flex flex-wrap gap-2">
                {[thisMonth, lastMonth]
                  .filter((m) => !v.mine.some((r) => r.month === m && r.status !== "returned" && r.status !== "withdrawn"))
                  .map((m) => (
                    <button key={m} type="button" className={m === thisMonth ? primaryBtn : quietBtn} onClick={() => startReport(m)}>
                      {t("exp.newReport", { month: monthName(m) })}
                    </button>
                  ))}
                {/* A month that already has a report gets no "new report" button; say where to add to it instead. */}
                {[thisMonth, lastMonth]
                  .filter((m) => v.mine.some((r) => r.month === m && r.status !== "returned" && r.status !== "withdrawn"))
                  .map((m) => (
                    <p key={m} className="w-full text-sm text-muted">
                      {t("exp.addToMonth", { month: monthName(m) })}
                    </p>
                  ))}
                <p className="w-full text-xs text-muted">{t("exp.olderMonths")}</p>
              </section>
            )}
            {v.mine.length > 0 && <List title={t("exp.yours")} items={v.mine} v={v} monthName={monthName} onOpen={show} first={v.mine.find((r) => r.status === "returned")?.n} />}
            {v.owed.length > 0 && <List title={t("exp.owed")} items={v.owed} v={v} monthName={monthName} onOpen={show} />}
            {v.others.length > 0 && <List title={v.seesAll ? t("exp.everyone") : t("exp.team")} items={v.others} v={v} monthName={monthName} onOpen={show} />}
            {!v.hasRecord && !v.waiting.length && !v.others.length && <Empty className="mt-8">{t("exp.noRecord")}</Empty>}
          </>
        )}
      </main>
    </div>
  );
}

/** `first`: the one report to look at first (one of yours sent back to correct); its status says why. */
function List({ title, items, v, monthName, onOpen, first }: { title: string; items: ExpenseView["mine"]; v: ExpenseView; monthName: (m: string) => string; onOpen: (n: number) => void; first?: number }) {
  const { t } = useT();
  return (
    <section>
      <SectionHead>{title}</SectionHead>
      <LedgerTable cols={LIST} head={["", { label: t("exp.total"), end: true }, ""]} label={title}>
        {items.map((r) => (
          <LedgerRow key={r.n} cols="minmax(0,1fr)" onClick={() => onOpen(r.n)} first={r.n === first} className="text-sm">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:grid sm:grid-cols-[minmax(0,1fr)_9rem_15rem]">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{r.person === v.me ? monthName(r.month) : `${v.names[r.person] ?? r.person} · ${monthName(r.month)}`}</span>
                <span className="block text-xs text-muted">
                  {t(r.lines === 1 ? "exp.lineOne" : "exp.lineMany", { n: r.lines })}
                  {r.version > 1 ? ` · ${t("exp.version", { n: r.version })}` : ""}
                </span>
              </span>
              <Fig>{money(r.total, r.currency)}</Fig>
              <span>{r.paid ? <StatusPill tone={r.paid.status === "approved" ? "forest" : "sky"}>{r.paid.status === "approved" ? t("exp.paidList", { month: r.paid.month }) : t("exp.inPayroll")}</StatusPill> : <StatusPill tone={STATUS[r.status].tone}>{t(STATUS[r.status].text)}</StatusPill>}</span>
            </span>
          </LedgerRow>
        ))}
      </LedgerTable>
    </section>
  );
}

/* ---------------- One report ---------------- */

function Detail({ v, monthName, back, act, revise }: { v: ExpenseView; monthName: (m: string) => string; back: () => void; act: (a: ExAction, msg: string) => Promise<void>; revise: (r: Report) => void }) {
  const r = v.open!;
  const { user } = useSession();
  const { t, date } = useT();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = useSourceLabel(v);
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
    <section className="mt-4 space-y-4">
      <button type="button" onClick={back} className="inline-flex min-h-11 items-center text-sm font-semibold text-forest hover:underline">
        {t("exp.allReports")}
      </button>
      <SectionHead className="" aside={r.paid ? <StatusBlock tone="forest">{r.paid.status === "approved" ? t("exp.paidDetail", { month: r.paid.month }) : t("exp.inPayroll")}</StatusBlock> : <StatusBlock tone={STATUS[r.status].tone}>{t(STATUS[r.status].text)}</StatusBlock>}>
        {r.person === v.me ? t("exp.yourExpenses", { month: monthName(r.report.month) }) : t("exp.theirExpenses", { name: name(r.person), month: monthName(r.report.month) })}
      </SectionHead>
      <p className="text-sm text-muted">
        {t("exp.submitted", { version: r.version, date: date(r.at.slice(0, 10)) })}
        {r.signatures.map((s) => ` · ${t(s.step === "supervisor" ? "exp.sigApproved" : "exp.sigAccepted", { name: name(s.by) })}`).join("")}
        {r.next && ` · ${t("exp.next", { people: r.next.people.map(name).join(` ${t("exp.or")} `) || t("exp.nobody") })}${r.next.via !== "supervisor" && r.next.via !== "Finance" ? ` (${VIA_KEY[r.next.via] ? t(VIA_KEY[r.next.via]) : r.next.via})` : ""}`}
      </p>
      {r.by !== r.person && (
        <p className="bg-sunken px-4 py-3 text-sm">
          {t("exp.enteredBy", { by: name(r.by), person: name(r.person) })}{" "}
          {r.report.paperClaim && (
            <button type="button" onClick={() => void openReceipt(r.report.paperClaim!.hash, user?.id)} className="font-semibold text-forest hover:underline">
              📎 {r.report.paperClaim.name}
            </button>
          )}
        </p>
      )}
      {r.returned && <p className="bg-clay-soft px-4 py-3 text-sm text-clay">{t("exp.sentBackBy", { name: name(r.returned.by), note: r.returned.note })}</p>}
      {(r.canSign || v.seesAll) && r.flags.length > 0 && (
        <ul className="space-y-1 bg-ochre-soft px-3 py-2 text-sm text-warn">
          {r.flags.map((f) => (
            <li key={f}>⚠ {f}</li>
          ))}
        </ul>
      )}
      <LedgerTable cols={LINES} head={["", t("exp.for"), { label: t("exp.amount", { currency: r.report.currency }), end: true }]} label={t("exp.monthExpenses", { month: monthName(r.report.month) })}>
        {r.report.lines.map((l, i) => (
          <LedgerRow key={i} cols="minmax(0,1fr) auto" n={i + 1} className="text-sm">
            <div className="min-w-0">
              <p className="font-medium">{l.description}</p>
              <p className="text-xs text-muted">
                <span className="font-mono tabular-nums">{l.date}</span> · {t(CAT_KEY[l.category])}
                {(r.canSign || v.seesAll) && CATEGORIES[l.category].gl ? ` (GL ${CATEGORIES[l.category].gl})` : ""} · {label(l.source)}
                {l.perDiem && ` · ${t("exp.perDiemLine", { place: l.perDiem.place, start: l.perDiem.start, end: l.perDiem.end, rate: l.perDiem.rate })}`}
                {l.category === "mileage" && ` · ${t("exp.mileageLine", { miles: l.miles ?? "", rate: mileageRateOf(l) })}`}
              </p>
              {(l.receipts.length > 0 || l.noReceipt) && (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  {l.receipts.map((rc) => (
                    <button key={rc.hash} type="button" onClick={() => void openReceipt(rc.hash, user?.id)} className="inline-flex min-h-11 items-center border border-line px-3 hover:border-forest" title={t("exp.fingerprint", { hash: rc.hash })}>
                      📎 {rc.name}
                    </button>
                  ))}
                  {l.noReceipt && <span className="text-warn">{t("exp.noReceiptWhy", { reason: l.noReceipt })}</span>}
                </p>
              )}
            </div>
            <Fig strong className="whitespace-nowrap">
              {money(amountOf(l), r.report.currency)}
            </Fig>
          </LedgerRow>
        ))}
      </LedgerTable>
      <Totals report={r.report} v={v} codes={r.canSign || v.seesAll} />
      {r.cannotSign && <p className="text-sm text-muted">{t("exp.cannotSign", { reason: r.cannotSign })}</p>}
      {note === null ? (
        <div className="flex flex-wrap gap-2">
          {r.canSign && (
            <>
              <button type="button" disabled={busy} className={primaryBtn} onClick={() => run({ action: "approve", report: r.n }, r.status === "pending" ? t("exp.approvedMsg") : t("exp.acceptedMsg"))}>
                {r.status === "pending" ? t("exp.approve") : t("exp.accept")}
              </button>
              <button type="button" disabled={busy} className={quietBtn} onClick={() => setNote("")}>
                {t("exp.sendBack")}
              </button>
            </>
          )}
          {r.canWithdraw && (
            <button type="button" disabled={busy} className={quietBtn} onClick={() => run({ action: "withdraw", report: r.n }, t("exp.withdrawnMsg"))}>
              {t("exp.withdraw")}
            </button>
          )}
          {r.person === v.me && (r.status === "returned" || r.status === "withdrawn" || r.status === "pending") && (
            <button type="button" className={quietBtn} onClick={() => revise(r.report)}>
              {r.status === "returned" ? t("exp.correct") : t("exp.editResubmit")}
            </button>
          )}
        </div>
      ) : (
        <Sheet className="">
          <label className="text-sm font-medium" htmlFor="ex-back">
            {t("exp.whatChange")}
          </label>
          <textarea id="ex-back" value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="mt-1 w-full border border-line bg-paper px-3 py-2 text-base" />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy || note.trim().length < 3} className={dangerBtn} onClick={() => run({ action: "return", report: r.n, note }, t("exp.sentBackMsg")).then(() => setNote(null))}>
              {t("exp.sendBack")}
            </button>
            <button type="button" className={quietBtn} onClick={() => setNote(null)}>
              {t("exp.cancel")}
            </button>
          </div>
        </Sheet>
      )}
    </section>
  );
}

/** `codes`: show the accounting (GL) codes, for Finance and approvers only. */
function Totals({ report, v, codes = v.seesAll }: { report: Report; v: ExpenseView; codes?: boolean }) {
  const { t } = useT();
  const s = useMemo(() => summary(report), [report]);
  const label = useSourceLabel(v);
  return (
    <div className="grid gap-x-8 gap-y-4 border-y border-ink py-3 font-ledger text-sm sm:grid-cols-2">
      <div>
        <h3 className="font-mono text-xs text-muted">{t("exp.byAccount")}</h3>
        <ul className="mt-1">
          {(Object.entries(s.byCategory) as [Category, number][]).map(([c, a]) => (
            <li key={c} className="flex justify-between gap-3 border-b border-line py-1.5">
              <span className="truncate">
                {codes && CATEGORIES[c].gl ? <span className="font-mono">{CATEGORIES[c].gl} </span> : ""}
                {t(CAT_KEY[c])}
              </span>
              <Fig className="whitespace-nowrap">{money(a, report.currency)}</Fig>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="font-mono text-xs text-muted">{t("exp.bySource")}</h3>
        <ul className="mt-1">
          {Object.entries(s.bySource).map(([k, a]) => (
            <li key={k} className="flex justify-between gap-3 border-b border-line py-1.5">
              <span className="truncate">{label(k)}</span>
              <Fig className="whitespace-nowrap">{money(a, report.currency)}</Fig>
            </li>
          ))}
        </ul>
        <p className="mt-2 flex justify-between gap-3 font-bold">
          <span>{t("exp.total")}</span>
          <Fig strong className="whitespace-nowrap">
            {money(s.total, report.currency)}
          </Fig>
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
  const { t } = useT();
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
    <section className="mt-8 space-y-4">
      <SectionHead className="">{forName ? t("exp.theirExpenses", { name: forName, month: monthName(report.month) }) : t("exp.monthExpenses", { month: monthName(report.month) })}</SectionHead>
      {forName && (
        <Sheet tone="gold" className="text-sm">
          <p className="font-semibold">{t("exp.paperSigned")}</p>
          <p className="mt-1 text-muted">{t("exp.paperScan", { name: forName })}</p>
          <label className={`${quietBtn} mt-2 block w-fit cursor-pointer`}>
            {report.paperClaim ? `📎 ${report.paperClaim.name}` : t("exp.attachClaim")}
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
        </Sheet>
      )}
      <p className="text-sm text-muted">{t("exp.currencyNote", { currency: report.currency })}</p>
      {report.lines.length > 0 && (
        <p role="status" className="border border-warn/40 bg-ochre-soft px-4 py-3 text-sm font-semibold text-warn">
          {t("exp.unsent")}
        </p>
      )}
      {report.lines.length > 0 && (
        <LedgerTable cols={`${LINES} 2.75rem`} head={["", t("exp.for"), { label: t("exp.amount", { currency: report.currency }), end: true }, ""]} label={t("exp.monthExpenses", { month: monthName(report.month) })} className="">
          {report.lines.map((l, i) => (
            <LedgerRow key={i} cols="minmax(0,1fr) auto 2.75rem" n={i + 1} className="text-sm">
              <button type="button" onClick={() => setEdit({ i, line: l })} className="min-h-11 min-w-0 text-start hover:underline">
                <span className="block truncate font-medium">{l.description || t(CAT_KEY[l.category])}</span>
                <span className="block text-xs text-muted">
                  <span className="font-mono tabular-nums">{l.date}</span> · {t(CAT_KEY[l.category])} · {l.receipts.length ? t(l.receipts.length > 1 ? "exp.receiptMany" : "exp.receiptOne", { n: l.receipts.length }) : l.category === "perDiem" || l.category === "mileage" ? t("exp.workedOut") : t("exp.noReceipt")}
                </span>
              </button>
              <Fig className="whitespace-nowrap">{money(amountOf(l), report.currency)}</Fig>
              <button type="button" aria-label={t("exp.removeLine", { n: i + 1 })} onClick={() => setReport({ ...report, lines: report.lines.filter((_, j) => j !== i) })} className="grid h-11 w-11 place-items-center text-muted hover:bg-sunken hover:text-ink">
                ×
              </button>
            </LedgerRow>
          ))}
        </LedgerTable>
      )}
      {edit ? (
        <LineForm v={v} month={report.month} currency={report.currency} line={edit.line} onSave={(l) => save(l, edit.i)} onCancel={() => setEdit(null)} />
      ) : (
        <button type="button" className={quietBtn} onClick={() => setEdit({ i: null, line: blank(report.month, report.lines.at(-1)?.source ?? v.sources[0]?.id ?? "non-contract") })}>
          {t("exp.addExpense")}
        </button>
      )}
      {report.lines.length > 0 && !edit && (
        <>
          <Totals report={report} v={v} />
          <label className="flex items-start gap-3 border-t-2 border-ink pt-4 text-sm">
            <input type="checkbox" checked={certify} onChange={(e) => setCertify(e.target.checked)} className="mt-0.5 h-5 w-5" />
            <span>
              {forName
                ? t("exp.certifyPaper", { name: forName })
                : t("exp.certify")}
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
              {busy ? t("exp.sending") : t("exp.submit")}
            </button>
            <button type="button" className={quietBtn} onClick={onCancel}>
              {t("exp.close")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function LineForm({ v, month, currency, line, onSave, onCancel }: { v: ExpenseView; month: string; currency: string; line: ExpenseLine; onSave: (l: ExpenseLine) => void; onCancel: () => void }) {
  const { user } = useSession();
  const { t } = useT();
  const sourceLabel = useSourceLabel(v);
  const [l, setL] = useState<ExpenseLine>(line);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<ExpenseLine>) => setL((cur) => ({ ...cur, ...patch }));
  const input = "mt-1 block min-h-11 w-full border border-line bg-paper px-3 py-2.5 text-base";
  const isPerDiem = l.category === "perDiem";
  const isMiles = l.category === "mileage";
  // The paying donor's rate, or ROP's default; the server fixes it again on submission.
  const rate = v.mileageRates[l.source]?.rate ?? MILEAGE_RATE;
  const pd = l.perDiem ?? { place: "", rate: 0, start: `${month}-01`, end: `${month}-01` };
  const calc = isPerDiem ? perDiemOf(pd) : null;
  const [dateFromPhoto, setDateFromPhoto] = useState("");
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError("");
    try {
      const added: Receipt[] = [];
      // The day the receipt was photographed, read from the photo before it is shrunk (which drops it).
      let taken: string | null = null;
      for (const f of Array.from(files)) {
        if (!taken && f.type === "image/jpeg") taken = photoFacts(await f.arrayBuffer()).date;
        const body = new FormData();
        body.append("file", await shrink(f));
        added.push(await call<Receipt>("/api/files", user?.id, { method: "POST", body }));
      }
      // Nobody types a date the photo already holds: while the line still has the month's first day
      // (nothing chosen yet) and the photo was taken in this claim's month, the photo's day is used.
      // It stays a date field, so a receipt photographed on a later day is put right in one tap.
      const fromPhoto = taken && taken.startsWith(`${month}-`) ? taken : null;
      setL((cur) => ({ ...cur, receipts: [...cur.receipts, ...added].slice(0, 10), ...(fromPhoto && cur.date === `${month}-01` && cur.category !== "perDiem" ? { date: fromPhoto } : {}) }));
      if (fromPhoto) setDateFromPhoto(fromPhoto);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };
  const problem =
    l.description.trim().length < 2
      ? t("exp.err.what")
      : isPerDiem
        ? !pd.place || !pd.rate || pd.end < pd.start
          ? t("exp.err.perDiem")
          : null
        : isMiles
          ? !(l.miles ?? 0)
            ? t("exp.err.miles")
            : null
          : !(l.amount ?? 0)
            ? t("exp.err.amount")
            : !l.receipts.length && (l.noReceipt ?? "").trim().length < 5
              ? t("exp.err.receipt")
              : null;
  return (
    <Sheet className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">
          <span className="font-medium">{t("exp.kind")}</span>
          <select value={l.category} onChange={(e) => set({ category: e.target.value as Category })} className={input}>
            {CATEGORY_KEYS.filter((c) => c !== "mileage" || currency === "USD").map((c) => (
              <option key={c} value={c}>
                {t(CAT_KEY[c])}
                {v.seesAll && CATEGORIES[c].gl ? ` (${CATEGORIES[c].gl})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="font-medium">{t("exp.for")}</span>
          <input value={l.description} onChange={(e) => set({ description: e.target.value })} placeholder={isPerDiem ? t("exp.ph.perDiem") : t("exp.ph.taxi")} className={input} />
        </label>
        {!isPerDiem && (
          <label className="text-sm">
            <span className="font-medium">{t("exp.date")}</span>
            <input type="date" value={l.date} onChange={(e) => set({ date: e.target.value })} className={input} />
            {dateFromPhoto && l.date === dateFromPhoto && <span className="mt-1 block text-xs text-muted">Filled in from the receipt photo. Change it if the receipt shows another day.</span>}
          </label>
        )}
        <label className="text-sm">
          <span className="font-medium">{t("exp.source")}</span>
          <select value={l.source} onChange={(e) => set({ source: e.target.value })} className={input}>
            {v.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {sourceLabel(s.id)}
              </option>
            ))}
          </select>
        </label>
        {isMiles ? (
          <label className="text-sm">
            <span className="font-medium">{t("exp.miles")}</span>
            <input type="number" inputMode="decimal" min={0} value={l.miles ?? ""} onChange={(e) => set({ miles: e.target.value === "" ? undefined : Number(e.target.value) })} className={input} />
            <span className="mt-1 block text-xs text-muted">{t("exp.mileRate", { rate, amount: money(amountOf({ ...l, rate }), currency) })} · {v.mileageRates[l.source]?.from ?? ""}</span>
          </label>
        ) : (
          !isPerDiem && (
            <label className="text-sm">
              <span className="font-medium">{t("exp.amount", { currency })}</span>
              <input type="number" inputMode="decimal" min={0} step="0.01" value={l.amount ?? ""} onChange={(e) => set({ amount: e.target.value === "" ? undefined : Number(e.target.value) })} className={input} />
            </label>
          )
        )}
      </div>
      {isPerDiem && (
        <fieldset className="grid gap-3 bg-sunken p-3 sm:grid-cols-2">
          <legend className="sr-only">{t("exp.perDiem")}</legend>
          <label className="text-sm">
            <span className="font-medium">{t("exp.place")}</span>
            <input value={pd.place} onChange={(e) => set({ perDiem: { ...pd, place: e.target.value } })} placeholder={t("exp.ph.place")} className={input} />
          </label>
          <label className="text-sm">
            <span className="font-medium">{t("exp.rate", { currency })}</span>
            <input type="number" inputMode="decimal" min={0} value={pd.rate || ""} onChange={(e) => set({ perDiem: { ...pd, rate: Number(e.target.value) || 0 } })} className={input} />
            <span className="mt-1 block text-xs text-muted">
              {t("exp.rateFrom")}{" "}
              <a href="https://aoprals.state.gov/web920/per_diem.asp" target="_blank" rel="noreferrer" className="underline">
                {t("exp.rateTable")}
              </a>{" "}
              {t("exp.rateAbroad")}{" "}
              <a href="https://www.gsa.gov/travel/plan-book/per-diem-rates" target="_blank" rel="noreferrer" className="underline">
                {t("exp.rateGsa")}
              </a>{" "}
              {t("exp.rateUs")}
            </span>
          </label>
          <label className="text-sm">
            <span className="font-medium">{t("exp.leftOn")}</span>
            <input type="date" value={pd.start} onChange={(e) => set({ perDiem: { ...pd, start: e.target.value }, date: e.target.value })} className={input} />
          </label>
          <label className="text-sm">
            <span className="font-medium">{t("exp.backOn")}</span>
            <input type="date" value={pd.end} min={pd.start} onChange={(e) => set({ perDiem: { ...pd, end: e.target.value } })} className={input} />
          </label>
          {calc && calc.days > 0 && (
            <p className="text-sm sm:col-span-2">
              {t("exp.calc", { travel: t(calc.partial === 1 ? "exp.travelDay" : "exp.travelDays", { n: calc.partial }), pct: FIRST_LAST_DAY * 100, full: t(calc.full === 1 ? "exp.fullDay" : "exp.fullDays", { n: calc.full }) })} <Fig strong>{money(calc.amount, currency)}</Fig>
            </p>
          )}
        </fieldset>
      )}
      {!isPerDiem && !isMiles && (
        <div className="text-sm">
          <span className="font-medium">{t("exp.receipt")}</span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {l.receipts.map((rc) => (
              <span key={rc.hash} className="inline-flex items-center gap-1 border border-line ps-3 text-xs">
                📎 {rc.name}
                <button type="button" aria-label={t("exp.removeFile", { name: rc.name })} onClick={() => set({ receipts: l.receipts.filter((x) => x.hash !== rc.hash) })} className="grid h-11 w-11 place-items-center text-muted hover:text-ink">
                  ×
                </button>
              </span>
            ))}
            <label className={`${quietBtn} cursor-pointer`}>
              {uploading ? t("exp.uploading") : t("exp.photoOrPdf")}
              <input type="file" accept="image/*,application/pdf" capture="environment" multiple className="sr-only" disabled={uploading} onChange={(e) => void upload(e.target.files)} />
            </label>
          </div>
          {!l.receipts.length && (
            <label className="mt-2 block">
              <span className="text-xs text-muted">{t("exp.noReceiptSay")}</span>
              <input value={l.noReceipt ?? ""} onChange={(e) => set({ noReceipt: e.target.value || undefined })} placeholder={t("exp.ph.noReceipt")} className={input} />
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
        <button type="button" className={primaryBtn} disabled={!!problem || uploading} onClick={() => onSave({ ...l, ...(isPerDiem ? { perDiem: pd, date: pd.start, amount: undefined, miles: undefined, receipts: [] } : isMiles ? { amount: undefined, perDiem: undefined, receipts: [], rate } : { perDiem: undefined, miles: undefined, rate: undefined }) })}>
          {t("exp.saveExpense")}
        </button>
        <button type="button" className={quietBtn} onClick={onCancel}>
          {t("exp.cancel")}
        </button>
        {problem && <span className="text-xs text-muted">{problem}</span>}
      </div>
    </Sheet>
  );
}
