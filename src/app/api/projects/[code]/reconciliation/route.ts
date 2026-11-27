import { NextResponse } from "next/server";
import { z } from "zod";
import { realToday } from "@/lib/clock";
import { people, requireViewer } from "@/server/auth";
import { projectByCode } from "@/server/field-store";
import { handle } from "@/server/guard";
import {
  bankAccountsOf,
  completeReconciliation,
  lockMonth,
  matchLine,
  matchSuggested,
  mayReadReconciliation,
  mayReconcile,
  monthPeriod,
  ownEntriesOn,
  reconciliationView,
  setStatementBalance,
  unmatchLine,
} from "@/server/reconciliation";
import { selfSchema, soloForOrganization } from "@/server/solo";
import { refusal } from "./http";

type Ctx = { params: Promise<{ code: string }> };
const WHY = "Bank reconciliation is for the organization's staff.";
const ONLY_FINANCE = "Only Finance or an administrator reconciles the bank.";

/** The month before today's, as YYYY-MM: the month usually being closed. */
function lastMonth(): string {
  const d = new Date(`${realToday().slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

async function answer(orgId: string, bank: string | null, month: string, finance: boolean, extra: Record<string, unknown> = {}, viewer?: string) {
  const banks = await bankAccountsOf(orgId);
  const chosen = banks.find((b) => b.id === bank) ?? banks.find((b) => b.active) ?? null;
  const view = chosen ? await reconciliationView(orgId, chosen.id, month, { detail: finance }) : null;
  // Names for who imported, reconciled and locked; nothing else about them.
  const ids = new Set<string>([view?.completed?.by, view?.locked?.by, ...(view?.statementLines.map((l) => l.importedBy) ?? [])].filter((x): x is string => !!x));
  const all = ids.size ? await people() : [];
  const names = Object.fromEntries(all.filter((p) => ids.has(p.id)).map((p) => [p.id, p.name]));
  return NextResponse.json({
    bankAccounts: banks.filter((b) => b.active || b.id === chosen?.id).map((b) => ({ id: b.id, name: b.name, currency: b.currency })),
    month: monthPeriod(month).slice(0, 7),
    canReconcile: finance,
    // Entries on this account this month that the viewer recorded or posted: with any, someone else completes it (ISS-04).
    ownEntries: finance && viewer && chosen && view && !view.completed ? await ownEntriesOn(orgId, chosen.id, month, viewer) : 0,
    view,
    names,
    ...extra,
  });
}

/** One bank account's month: the figures for everyone employed on the project, the lines for Finance. ?bank=<id>&month=YYYY-MM */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: mayReadReconciliation, why: WHY });
    if (v instanceof NextResponse) return v;
    const project = await projectByCode(decodeURIComponent(code));
    const url = new URL(req.url);
    const month = url.searchParams.get("month") || lastMonth();
    try {
      return await answer(project.organizationId, url.searchParams.get("bank"), month, await mayReconcile(v.user), {}, v.user.id);
    } catch (e) {
      return refusal(e);
    }
  }, "reconciliation");
}

const month = z.string().regex(/^\d{4}-\d{2}$/, "Say which month (YYYY-MM).");
const uuid = z.string().uuid("That record was not found.");
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("balance"), bankAccountId: uuid, month, balance: z.string().min(1, "Enter the closing balance.").max(30) }),
  z.object({ action: z.literal("match"), bankAccountId: uuid, month, statementLineId: uuid, journalLineId: uuid }),
  z.object({ action: z.literal("unmatch"), bankAccountId: uuid, month, statementLineId: uuid }),
  z.object({ action: z.literal("match_suggested"), bankAccountId: uuid, month }),
  z.object({ action: z.literal("complete"), bankAccountId: uuid, month, self: selfSchema.optional() }),
  z.object({ action: z.literal("lock"), bankAccountId: uuid, month }),
]);

/** Finance's actions on the month: closing balance, match, unmatch, match every suggestion, complete, lock. Answers with the month again. */
export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: mayReadReconciliation, why: WHY });
    if (v instanceof NextResponse) return v;
    if (!(await mayReconcile(v.user))) return NextResponse.json({ error: ONLY_FINANCE }, { status: 403 });
    const parsed = action.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    const a = parsed.data;
    const project = await projectByCode(decodeURIComponent(code));
    const orgId = project.organizationId;
    const by = v.user.id;
    const extra: Record<string, unknown> = {};
    try {
      if (a.action === "balance") await setStatementBalance({ organizationId: orgId, bankAccountId: a.bankAccountId, month: a.month, balance: a.balance, by });
      else if (a.action === "match") await matchLine({ organizationId: orgId, statementLineId: a.statementLineId, journalLineId: a.journalLineId, by, projectId: project.id });
      else if (a.action === "unmatch") await unmatchLine({ organizationId: orgId, statementLineId: a.statementLineId, by, projectId: project.id });
      else if (a.action === "match_suggested") extra.matched = await matchSuggested({ organizationId: orgId, bankAccountId: a.bankAccountId, month: a.month, by, projectId: project.id });
      else if (a.action === "complete") extra.completed = await completeReconciliation({ organizationId: orgId, bankAccountId: a.bankAccountId, month: a.month, by, projectId: project.id, solo: await soloForOrganization(orgId), self: a.self });
      else extra.lock = await lockMonth({ organizationId: orgId, bankAccountId: a.bankAccountId, month: a.month, by });
      return await answer(orgId, a.bankAccountId, a.month, true, extra, by);
    } catch (e) {
      return refusal(e);
    }
  }, "reconciliation");
}
