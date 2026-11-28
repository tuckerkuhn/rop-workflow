import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { z } from "zod";
import { ACCOUNT_TYPES, accountDetails, accountFlags } from "@/lib/payment-accounts";
import { people, requireViewer } from "@/server/auth";
import { handle, readBody, HttpError } from "@/server/guard";
import { moneyAccounts } from "@/server/ledger-setup";
import { orgIdForPerson } from "@/server/org-settings-store";
import { decideAccount, loadAccounts, mayKeepAccounts, proposeAccount } from "@/server/payment-accounts-store";

/** The payment accounts register (lib/payment-accounts, MF-06), for the people who keep it. */
async function view(orgId: string, me: string) {
  const [money, reg, list] = await Promise.all([moneyAccounts(orgId), loadAccounts(orgId), people()]);
  const name = (id: string) => list.find((p) => p.id === id)?.name ?? id;
  const [o] = await db.select({ name: s.organizations.name }).from(s.organizations).where(eq(s.organizations.id, orgId)).limit(1);
  return {
    orgName: o?.name ?? "",
    types: ACCOUNT_TYPES,
    staff: list.filter((p) => p.kind === "employee").map((p) => ({ id: p.id, name: p.name })),
    accounts: money.map((m) => {
      const r = reg.accounts[m.bankAccountId];
      return { ...m, registered: r ? { ...r, signatoryNames: r.signatories.map(name), proposedByName: name(r.proposedBy), confirmedByName: name(r.confirmedBy) } : null, flags: accountFlags(r) };
    }),
    pending: reg.pending.map((c) => ({ ...c, mine: c.by === me })),
  };
}

const org = async (id: string) => {
  const o = await orgIdForPerson(id);
  if (!o) throw new HttpError(409, "No organization is set up yet.");
  return o;
};

export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: mayKeepAccounts, why: "Only Finance, the CFO or an administrator sees the payment accounts register." });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await view(await org(v.user.id), v.user.id), { headers: { "Cache-Control": "private, no-store" } });
  });
}

const body = z.union([z.object({ action: z.literal("propose"), details: accountDetails, reason: z.string().trim().min(5, "Say why the account is added or changed.").max(500) }), z.object({ action: z.literal("decide"), change: z.string().uuid(), confirm: z.boolean() })]);

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: mayKeepAccounts, why: "Only Finance, the CFO or an administrator keeps the payment accounts register." });
    if (v instanceof NextResponse) return v;
    const b = await readBody(req, body, "That change is not complete.");
    const o = await org(v.user.id);
    if (b.action === "propose") await proposeAccount(o, b.details, b.reason, v.user);
    else await decideAccount(o, b.change, b.confirm, v.user);
    return NextResponse.json(await view(o, v.user.id));
  });
}
