import { NextResponse } from "next/server";
import { formatAskedFor } from "@/lib/obligations";
import { requireViewer } from "@/server/auth";
import { projectByCode } from "@/server/field-store";
import { handle } from "@/server/guard";
import { loadObligations, projectDonors } from "@/server/obligations-store";

/** What each report must look like: the reporting obligations confirmed from the agreement, with each donor's asked-for format. Staff only. */
export type ObligationFormat = { donor: string | null; name: string; frequency: string; format: { text: string; href: string | null } | null };

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const project = await projectByCode(code);
    const list = await loadObligations(project.id);
    const donors = list.length ? new Map((await projectDonors(project.id)).map((d) => [d.id, d.name])) : new Map<string, string>();
    const obligations: ObligationFormat[] = list.map((o) => ({ donor: o.donorId ? (donors.get(o.donorId) ?? null) : null, name: o.name, frequency: o.frequency, format: formatAskedFor(o) }));
    return NextResponse.json({ obligations });
  });
}
