import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_STEPS, HR_ROLES, ROLE_LABEL, type HrRole } from "@/lib/hr";
import { requireViewer } from "@/server/auth";
import { eligibleSigners } from "@/server/hr-signers";
import { handle } from "@/server/guard";
import { append, hrBook, loadHr } from "@/server/hr-store";

/**
 * Starts the HR record: its first entry names who holds each approval role. It can be written
 * once; after it, the authority table changes only through a proposal signed by the executive
 * head and the board. In a real book it can never be changed or deleted, so the table is
 * checked before it is written.
 */

const bodySchema = z.object({
  holders: z.partialRecord(z.enum(HR_ROLES), z.array(z.string().min(1).max(60)).max(20)),
  /** The book's name, typed to confirm. */
  confirm: z.string(),
});

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" && !!u.admin, why: "Only an administrator can start the HR record." });
    if (v instanceof NextResponse) return v;
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Check the form." }, { status: 400 });
    const { holders, confirm } = parsed.data;
    const book = hrBook();
    if (confirm.trim() !== book) return NextResponse.json({ error: `Type the book's name, "${book}", to confirm.` }, { status: 400 });
    const { state } = await loadHr();
    if (state.rules) return NextResponse.json({ error: "The HR record has already been started. Change the authority table with a proposal." }, { status: 409 });

    const known = new Set(await eligibleSigners());
    const clean: Partial<Record<HrRole, string[]>> = {};
    for (const r of HR_ROLES) {
      const ids = [...new Set(holders[r] ?? [])];
      const unknown = ids.filter((x) => !known.has(x));
      if (unknown.length) return NextResponse.json({ error: `${ROLE_LABEL[r]}: ${unknown.join(", ")} cannot hold an approval role: only active staff with a sign-in email can. Add them under Settings, People and roles first.` }, { status: 400 });
      clean[r] = ids;
    }
    // Without these, nobody could ever sign a change to the table, hire anyone, or see the record.
    for (const r of ["ceo", "board", "hr"] as const) if (!clean[r]?.length) return NextResponse.json({ error: `Name at least one ${ROLE_LABEL[r]}: without one, changes to the record could never be signed.` }, { status: 400 });
    const both = clean.ceo!.filter((x) => clean.board!.includes(x));
    if (both.length) return NextResponse.json({ error: `${both.join(", ")} is both ${ROLE_LABEL.ceo} and ${ROLE_LABEL.board}. Nobody may sign two steps of one change, so the authority table could never be changed.` }, { status: 400 });

    const n = await append(v.actor.id, "start", null, { rules: { steps: DEFAULT_STEPS, holders: clean } });
    return NextResponse.json({ started: true, n, book });
  });
}
