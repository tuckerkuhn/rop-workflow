"use client";

import { lastScreening } from "@/lib/suppliers";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/components/app/session";
import { isFileLink, storeNames } from "@/lib/file-store";
import type { SupplierRow } from "@/components/procurement/suppliers-page";
import { bidUsd, distributionState, fromField, lateBids, lowBids, lowestPassing, reviewKey, sampleNeeded, type Bid, type CommitteeMember, type Procurement } from "@/lib/procurement";

/**
 * Bids as records: each quotation or bid with its receipt time, amount and file; the opening; the
 * committee and their declarations; pass/fail with reasons; and the bid chosen. The checks read
 * these, so a step completes on what was recorded, not on a tick.
 */

type Update = (fn: (p: Procurement) => Procurement) => void;
const box = "border-b border-line bg-paper/60 px-5 py-5";
const field = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none disabled:bg-paper disabled:text-muted";
const lbl = "text-xs font-medium text-muted";
const num = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(/,/g, "")));
const unreview = (q: Procurement) => {
  const checks = { ...q.checks };
  delete checks[reviewKey(q)];
  return checks;
};

/** Where bids are received: their amounts, times and files can be entered. Later steps judge them. */
const RECEIVING = ["quotes", "bids"];

export function BidsPanel({ p, editable, update, register, money }: { p: Procurement; editable: boolean; update: Update; register?: SupplierRow[] | null; money: (usd: number) => string }) {
  // The organization's file stores, from the session, so this renders again when they arrive or change.
  const { fileStores } = useSession();
  const names = storeNames(fileStores.now);
  const bids = p.bids ?? [];
  const receiving = RECEIVING.includes(p.step);
  const committee = p.step === "evaluate";
  const opening = p.step === "bids";
  const set = (fn: (q: Procurement) => Partial<Procurement>) => update((q) => ({ ...q, ...fn(q), checks: unreview(q) }));
  const setBid = (id: string, patch: Partial<Bid>) => set((q) => ({ bids: (q.bids ?? []).map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
  const add = () => set((q) => ({ bids: [...(q.bids ?? []), { id: `B${(q.bids ?? []).length + 1}`, supplier: "", receivedAt: "", amount: NaN, currency: "USD", evidence: "", passes: null, failWhy: "", lowNote: "" }] }));
  const late = new Set(lateBids(p).map((b) => b.id));
  const low = new Set(lowBids(p).map((b) => b.id));
  const lowest = lowestPassing(p);

  return (
    <fieldset className={box} disabled={!editable}>
      <legend className="sr-only">Bids</legend>
      <p className="text-sm font-semibold">{p.step === "quotes" ? "Quotations received" : "Bids received"}</p>
      <p className="mt-1 text-xs text-muted">
        {receiving ? `One line per quotation or bid, as received, with the signed copy in ${names}. Amounts cannot change once this step is done.` : "As received. Judge each against the minimum requirements, then mark the one chosen."}
        {p.closingDate ? ` Closing date ${p.closingDate}: anything later is rejected.` : ""}
      </p>

      {bids.length > 0 && (
        <ul className="mt-3 space-y-3">
          {bids.map((b) => (
            <li key={b.id} className="rounded-xl border border-line bg-surface p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
                <label>
                  <span className={lbl}>Supplier</span>
                  {register ? (
                    <input
                      list={`suppliers-${p.id}`}
                      disabled={!receiving}
                      value={b.supplier}
                      onChange={(e) => {
                        const r = register.find((x) => x.name === e.target.value);
                        setBid(b.id, { supplier: e.target.value, supplierId: r?.id });
                      }}
                      className={`mt-1 ${field}`}
                    />
                  ) : (
                    <input disabled={!receiving} value={b.supplier} onChange={(e) => setBid(b.id, { supplier: e.target.value })} className={`mt-1 ${field}`} />
                  )}
                  {/* Whether this supplier is in the register yet: it must be before it is cleared to deliver. */}
                  {register && b.supplier.trim() && (() => {
                    const r = register.find((x) => x.id === b.supplierId);
                    if (r) return <span className={`mt-1 block text-xs ${r.gaps.length ? "text-warn" : "text-muted"}`}>{r.gaps.length ? `In the supplier register, ${r.gaps.length} to resolve: ${r.gaps.join("; ")}` : "✓ In the supplier register, ready"}</span>;
                    return (
                      <span className="mt-1 block text-xs text-warn">
                        Not in the supplier register yet.{" "}
                        <Link href="/work/suppliers" className="font-semibold text-forest underline">
                          Add it
                        </Link>{" "}
                        with its licence and bank details before it is cleared to deliver; then pick it here.
                      </span>
                    );
                  })()}
                </label>
                <label>
                  <span className={lbl}>Received</span>
                  <input type="datetime-local" disabled={!receiving} value={b.receivedAt} onChange={(e) => setBid(b.id, { receivedAt: e.target.value })} className={`mt-1 ${field}`} />
                </label>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[8rem_7rem_7rem_1fr]">
                <label>
                  <span className={lbl}>Amount</span>
                  <input inputMode="decimal" disabled={!receiving} value={Number.isNaN(b.amount) ? "" : String(b.amount)} onChange={(e) => setBid(b.id, { amount: num(e.target.value) })} className={`mt-1 ${field} tabular-nums`} />
                </label>
                <label>
                  <span className={lbl}>Currency</span>
                  <select disabled={!receiving} value={b.currency} onChange={(e) => setBid(b.id, { currency: e.target.value as Bid["currency"] })} className={`mt-1 ${field}`}>
                    <option value="USD">USD</option>
                    <option value="AFN">AFN</option>
                  </select>
                </label>
                {b.currency === "AFN" ? (
                  <label>
                    <span className={lbl}>AFN per USD</span>
                    <input inputMode="decimal" disabled={!receiving} value={b.rate === undefined || Number.isNaN(b.rate) ? "" : String(b.rate)} onChange={(e) => setBid(b.id, { rate: num(e.target.value) })} className={`mt-1 ${field} tabular-nums`} />
                  </label>
                ) : (
                  <span />
                )}
                <label>
                  <span className={lbl}>Signed copy (link to {names})</span>
                  <input disabled={!receiving} value={b.evidence} onChange={(e) => setBid(b.id, { evidence: e.target.value })} className={`mt-1 ${field}`} />
                </label>
              </div>
              <p className="mt-2 text-xs text-muted">
                {bidUsd(b) !== null && !Number.isNaN(bidUsd(b)!) ? `${money(bidUsd(b)!)} · ` : ""}
                {late.has(b.id) && <span className="font-semibold text-clay">Received after closing: reject it. </span>}
                {lowest?.id === b.id && "Lowest that passed. "}
              </p>

              {!receiving || p.step === "quotes" ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-[10rem_1fr]">
                  <label>
                    <span className={lbl}>Minimum requirements</span>
                    <select value={b.passes === null ? "" : b.passes ? "pass" : "fail"} onChange={(e) => setBid(b.id, { passes: e.target.value === "" ? null : e.target.value === "pass" })} className={`mt-1 ${field}`}>
                      <option value="">Not judged</option>
                      <option value="pass">Pass</option>
                      <option value="fail">Fail</option>
                    </select>
                  </label>
                  {b.passes === false && (
                    <label>
                      <span className={lbl}>Why it failed</span>
                      <input value={b.failWhy} onChange={(e) => setBid(b.id, { failWhy: e.target.value })} className={`mt-1 ${field}`} />
                    </label>
                  )}
                  {committee && p.evaluation === "bestValue" && b.passes && (
                    <label>
                      <span className={lbl}>Committee score</span>
                      <input inputMode="decimal" value={b.score === undefined || Number.isNaN(b.score) ? "" : String(b.score)} onChange={(e) => setBid(b.id, { score: num(e.target.value) })} className={`mt-1 ${field} tabular-nums`} />
                    </label>
                  )}
                  {low.has(b.id) && (
                    <label className="sm:col-span-2">
                      <span className={lbl}>Under 75% of the estimate: what the supplier showed to prove it can deliver</span>
                      <input value={b.lowNote} onChange={(e) => setBid(b.id, { lowNote: e.target.value })} className={`mt-1 ${field}`} />
                    </label>
                  )}
                  <label className="flex items-center gap-2 text-sm sm:col-span-2">
                    <input type="radio" name={`chosen-${p.id}`} checked={p.selectedBid === b.id} disabled={b.passes !== true} onChange={() =>
                      set(() => {
                        // A registered supplier chosen here carries on to screening; at the quotation step the record takes it now.
                        const r = register?.find((x) => x.id === b.supplierId);
                        return p.step === "quotes" && r ? { selectedBid: b.id, supplier: { id: r.id, name: r.name, screenedOn: lastScreening(r)?.date ?? "", licenceNo: r.licenceNo, licenceExpiry: r.licenceExpiry } } : { selectedBid: b.id };
                      })
                    }
                  />
                    Chosen
                  </label>
                </div>
              ) : null}

              {receiving && (
                <button type="button" onClick={() => set((q) => ({ bids: (q.bids ?? []).filter((x) => x.id !== b.id), selectedBid: q.selectedBid === b.id ? undefined : q.selectedBid }))} className="mt-2 text-xs text-muted hover:text-clay">
                  Remove this line
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {register && (
        <datalist id={`suppliers-${p.id}`}>
          {register.map((r) => (
            <option key={r.id} value={r.name} />
          ))}
        </datalist>
      )}
      {receiving && (
        <button type="button" onClick={add} className="mt-3 text-sm font-medium text-forest hover:underline">
          + Add {p.step === "quotes" ? "a quotation" : "a bid"}
        </button>
      )}

      {opening && (
        <div className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-[12rem_1fr]">
          <p className="text-sm font-semibold sm:col-span-2">Bid opening</p>
          <label>
            <span className={lbl}>Opened</span>
            <input type="datetime-local" value={p.opening?.at ?? ""} onChange={(e) => set((q) => ({ opening: { present: "", evidence: "", ...q.opening, at: e.target.value } }))} className={`mt-1 ${field}`} />
          </label>
          <label>
            <span className={lbl}>Present (names)</span>
            <input value={p.opening?.present ?? ""} onChange={(e) => set((q) => ({ opening: { at: "", evidence: "", ...q.opening, present: e.target.value } }))} className={`mt-1 ${field}`} />
          </label>
          <label className="sm:col-span-2">
            <span className={lbl}>Signed opening record (link to {names})</span>
            <input value={p.opening?.evidence ?? ""} onChange={(e) => set((q) => ({ opening: { at: "", present: "", ...q.opening, evidence: e.target.value } }))} className={`mt-1 ${field}`} />
          </label>
        </div>
      )}

      {committee && <CommitteeEditor p={p} set={set} />}
    </fieldset>
  );
}

function CommitteeEditor({ p, set }: { p: Procurement; set: (fn: (q: Procurement) => Partial<Procurement>) => void }) {
  // The organization's file stores, from the session, so this renders again when they arrive or change.
  const { fileStores } = useSession();
  const names = storeNames(fileStores.now);
  const c = p.committee ?? [];
  const put = (i: number, patch: Partial<CommitteeMember>) => set((q) => ({ committee: (q.committee ?? []).map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
  return (
    <div className="mt-4 border-t border-line pt-4">
      <p className="text-sm font-semibold">Committee</p>
      <p className="mt-1 text-xs text-muted">At least three members sitting, one of them the chair. Each signs a declaration against the named bidders before seeing a bid; anyone connected to a bidder withdraws.</p>
      <ul className="mt-2 space-y-2">
        {c.map((m, i) => (
          <li key={i} className="grid gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-[1fr_7rem_9rem]">
            <label>
              <span className={lbl}>Name</span>
              <input value={m.name} onChange={(e) => put(i, { name: e.target.value })} className={`mt-1 ${field}`} />
            </label>
            <label>
              <span className={lbl}>Role</span>
              <select value={m.role} onChange={(e) => put(i, { role: e.target.value as CommitteeMember["role"] })} className={`mt-1 ${field}`}>
                <option value="member">Member</option>
                <option value="chair">Chair</option>
              </select>
            </label>
            <label>
              <span className={lbl}>Declared on</span>
              <input type="date" value={m.declaredOn} onChange={(e) => put(i, { declaredOn: e.target.value })} className={`mt-1 ${field}`} />
            </label>
            <label className="sm:col-span-2">
              <span className={lbl}>Signed declaration (link to {names})</span>
              <input value={m.declaration} onChange={(e) => put(i, { declaration: e.target.value })} className={`mt-1 ${field}`} />
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={m.conflict} onChange={(e) => put(i, { conflict: e.target.checked })} />
              Conflict: withdrew
            </label>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => set((q) => ({ committee: [...(q.committee ?? []), { name: "", role: (q.committee ?? []).length ? "member" : "chair", declaredOn: "", declaration: "", conflict: false }] }))} className="mt-2 text-sm font-medium text-forest hover:underline">
        + Add a member
      </button>
    </div>
  );
}

/**
 * Goods handed on to participants: each signed distribution list, what is still in stock, and a
 * check on a sample of recipients by someone who did not hand the goods out. Open to anyone with
 * procurement access from receipt to close, whoever owns the step.
 */
export function DistributionPanel({
  p,
  canEdit,
  update,
  me,
  resultLink,
  viaField = false,
}: {
  /** The goods are in the Field input package: each approved distribution in Field activities is added here, so no list is typed. */
  viaField?: boolean;
  p: Procurement;
  canEdit: boolean;
  update: Update;
  me: { id: string; name: string };
  /** The Results page with the people reached filled in, for a person to check and send (lib/connections.ts). */
  resultLink?: (people: { value: number; female: number; male: number; date?: string; place?: string }) => string;
}) {
  const d = p.distribution ?? { forParticipants: false, lists: [], inStock: 0, checks: [] };
  // The organization's file stores, from the session, so this renders again when they arrive or change.
  const { fileStores } = useSession();
  const names = storeNames(fileStores.now);
  const isLink = (u: string) => isFileLink(u, fileStores.now);
  const [list, setList] = useState({ date: "", place: "", recipients: "", women: "", qty: "", evidence: "" });
  const [chk, setChk] = useState({ on: "", sampled: "", confirmed: "", issues: "", evidence: "" });
  const put = (patch: Partial<typeof d>) => update((q) => ({ ...q, distribution: { ...d, ...patch } }));
  const state = distributionState(p);
  const distributor = d.lists.some((l) => l.by === me.id);
  const people = d.lists.reduce((s, l) => s + l.recipients, 0);
  const listOk = list.date && list.place.trim() && Number(list.recipients) > 0 && Number(list.qty) > 0 && isLink(list.evidence) && Number(list.women || 0) <= Number(list.recipients);
  const chkOk = chk.on && Number(chk.sampled) > 0 && Number(chk.confirmed) >= 0 && Number(chk.confirmed) <= Number(chk.sampled) && isLink(chk.evidence);
  // What is still missing, said beside the button rather than leaving it greyed out without a reason.
  const listMissing = [
    !list.date && "the date",
    !list.place.trim() && "the village or site",
    !(Number(list.qty) > 0) && "the quantity",
    !(Number(list.recipients) > 0) && "how many people are on the list",
    Number(list.women || 0) > Number(list.recipients) && "women cannot be more than the people on the list",
    !isLink(list.evidence) && `a link to the signed list in ${names}`,
  ].filter(Boolean) as string[];
  const chkMissing = [
    !chk.on && "the date",
    !(Number(chk.sampled) > 0) && "how many were contacted",
    chk.confirmed === "" && "how many confirmed",
    Number(chk.confirmed) > Number(chk.sampled) && "confirmed cannot be more than contacted",
    !isLink(chk.evidence) && `a link to the verification record in ${names} (call notes or visit form)`,
  ].filter(Boolean) as string[];
  const started = (o: Record<string, string>) => Object.values(o).some((v) => v.trim());
  return (
    <section className={box}>
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm font-semibold">Distribution to participants</p>
        {!viaField && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={!canEdit || (d.forParticipants && d.lists.length > 0)} checked={d.forParticipants} onChange={(e) => put({ forParticipants: e.target.checked })} />
            These goods go to participants
          </label>
        )}
      </div>
      {viaField && (
        <p className="mt-1 text-sm text-muted">
          These goods are in the Field input package, so they are handed out farmer by farmer in Field activities. Each distribution the project manager approves is added below; nothing is typed here.
        </p>
      )}
      {d.forParticipants && (
        <>
          {state && <p className={`mt-2 text-sm ${state.ok ? "text-forest" : "text-warn"}`}>{state.detail}</p>}
          {d.lists.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {d.lists.map((l, i) => (
                <li key={i}>
                  {l.date} · {l.place}: {l.qty.toLocaleString("en-US")} {l.qty === 1 ? p.unit.replace(/s$/, "") : p.unit} to {l.recipients} {l.recipients === 1 ? "person" : "people"} ({l.women} {l.women === 1 ? "woman" : "women"}), {fromField(l) ? "approved by" : "recorded by"} {l.byName}{" "}
                  <a href={l.evidence} target="_blank" rel="noreferrer" className="text-forest hover:underline">
                    signed list
                  </a>
                </li>
              ))}
            </ul>
          )}
          {resultLink && d.lists.length > 0 && (
            <p className="mt-2 text-sm">
              <Link
                className="font-semibold text-forest hover:underline"
                href={resultLink({
                  value: people,
                  female: d.lists.reduce((s, l) => s + l.women, 0),
                  male: people - d.lists.reduce((s, l) => s + l.women, 0),
                  date: d.lists.map((l) => l.date).sort().at(-1),
                  place: [...new Set(d.lists.map((l) => l.place))].join(", "),
                })}
              >
                Record the people reached in Results
              </Link>{" "}
              <span className="text-xs text-muted">Filled in from the lists; MEL checks it like any other result.</span>
            </p>
          )}
          {d.checks.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {d.checks.map((c, i) => (
                <li key={i}>
                  Verified {c.on} by {c.byName}: {c.confirmed} of {c.sampled} confirmed{c.issues ? ` · ${c.issues}` : ""}{" "}
                  <a href={c.evidence} target="_blank" rel="noreferrer" className="text-forest hover:underline">
                    record
                  </a>
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <>
              <label className="mt-3 flex max-w-xs items-center gap-2 text-sm">
                <span className="shrink-0 text-muted">Still in stock ({p.unit})</span>
                <input inputMode="decimal" value={String(d.inStock)} onChange={(e) => put({ inStock: Number(e.target.value) || 0 })} className={`${field} tabular-nums`} />
              </label>
              {!viaField && (
              <form
                className="mt-4 grid gap-2 border-t border-line pt-3 sm:grid-cols-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!listOk) return;
                  put({ lists: [...d.lists, { date: list.date, place: list.place.trim(), recipients: Number(list.recipients), women: Number(list.women || 0), qty: Number(list.qty), evidence: list.evidence.trim(), by: me.id, byName: me.name }] });
                  setList({ date: "", place: "", recipients: "", women: "", qty: "", evidence: "" });
                }}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-muted sm:col-span-3">Add a signed distribution list</p>
                <input type="date" aria-label="Date" value={list.date} onChange={(e) => setList({ ...list, date: e.target.value })} className={field} />
                <input placeholder="Village or site" value={list.place} onChange={(e) => setList({ ...list, place: e.target.value })} className={field} />
                <input inputMode="decimal" placeholder={`Quantity (${p.unit})`} value={list.qty} onChange={(e) => setList({ ...list, qty: e.target.value })} className={field} />
                <input inputMode="numeric" placeholder="People on the list" value={list.recipients} onChange={(e) => setList({ ...list, recipients: e.target.value })} className={field} />
                <input inputMode="numeric" placeholder="Of them, women" value={list.women} onChange={(e) => setList({ ...list, women: e.target.value })} className={field} />
                <input placeholder={`Signed list (link to ${names})`} value={list.evidence} onChange={(e) => setList({ ...list, evidence: e.target.value })} className={field} />
                <button type="submit" disabled={!listOk} className="justify-self-start text-sm font-semibold text-forest hover:underline disabled:opacity-40 sm:col-span-3">
                  Add list
                </button>
                {!listOk && started(list) && <p className="text-xs text-muted sm:col-span-3">Still needed: {listMissing.join("; ")}.</p>}
              </form>
              )}
              {d.lists.some((l) => !fromField(l)) &&
                (distributor ? (
                  <p className="mt-3 text-xs text-muted">You recorded a list, so someone else verifies a sample of {sampleNeeded(people)} recipients.</p>
                ) : (
                  <form
                    className="mt-4 grid gap-2 border-t border-line pt-3 sm:grid-cols-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!chkOk) return;
                      put({ checks: [...d.checks, { on: chk.on, sampled: Number(chk.sampled), confirmed: Number(chk.confirmed), issues: chk.issues.trim(), evidence: chk.evidence.trim(), by: me.id, byName: me.name }] });
                      setChk({ on: "", sampled: "", confirmed: "", issues: "", evidence: "" });
                    }}
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted sm:col-span-3">Verify a sample (at least {sampleNeeded(people)} recipients, by phone or visit)</p>
                    <input type="date" aria-label="Date verified" value={chk.on} onChange={(e) => setChk({ ...chk, on: e.target.value })} className={field} />
                    <input inputMode="numeric" placeholder="Contacted" value={chk.sampled} onChange={(e) => setChk({ ...chk, sampled: e.target.value })} className={field} />
                    <input inputMode="numeric" placeholder="Confirmed receipt" value={chk.confirmed} onChange={(e) => setChk({ ...chk, confirmed: e.target.value })} className={field} />
                    <input placeholder="What was found, if anything" value={chk.issues} onChange={(e) => setChk({ ...chk, issues: e.target.value })} className={`${field} sm:col-span-2`} />
                    <input placeholder={`Verification record (link to ${names})`} value={chk.evidence} onChange={(e) => setChk({ ...chk, evidence: e.target.value })} className={field} />
                    <button type="submit" disabled={!chkOk} className="justify-self-start text-sm font-semibold text-forest hover:underline disabled:opacity-40 sm:col-span-3">
                      Record verification
                    </button>
                    {!chkOk && started(chk) && <p className="text-xs text-muted sm:col-span-3">Still needed: {chkMissing.join("; ")}.</p>}
                  </form>
                ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
