import { NextResponse } from "next/server";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { moneySource, proofFor } from "@/server/proof";

/**
 * The proof behind a figure, for staff: ?indicator=IND-3&from=2026-10-01&to=2026-12-31 (from may be
 * left out: since the start), or ?money=1 for where the spending figures come from. With
 * &asOf=<a moment>, only the records accepted by then: the ones behind a figure kept on that day.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, {
      allow: (u) => u.kind === "employee",
      why: "The records behind the figures are for project staff.",
    });
    if (v instanceof NextResponse) return v;
    const q = new URL(req.url).searchParams;
    if (q.get("money") === "1")
      return NextResponse.json({ sources: await moneySource(code) });
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const indicator = q.get("indicator") ?? "";
    const from = q.get("from");
    const to = q.get("to") ?? "";
    if (!indicator || !day.test(to) || (from && !day.test(from)))
      return NextResponse.json(
        { error: "Choose an indicator and a period." },
        { status: 400 },
      );
    const asOf = q.get("asOf");
    if (asOf && Number.isNaN(Date.parse(asOf)))
      return NextResponse.json(
        { error: "Give the moment as a date and time." },
        { status: 400 },
      );
    const p = await proofFor(
      code,
      indicator,
      from || null,
      to,
      // Compared as text with the moment each result was accepted, so always in the form those are kept in.
      asOf ? new Date(asOf).toISOString() : undefined,
    );
    if (!p)
      return NextResponse.json(
        { error: "No such indicator." },
        { status: 404 },
      );
    return NextResponse.json(p);
  });
}
