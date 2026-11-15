import { NextResponse } from "next/server";
import { z } from "zod";
import { people, requireViewer } from "@/server/auth";
import { decideDistribution, listDistributions, mayApprove, mayFix, resubmitDistribution, tokenOpens } from "@/server/distribution";
import { handle, HttpError, readBody } from "@/server/guard";

/**
 * One input distribution for the project manager: what was handed out, the goods received and
 * quantity checks, and what to look at. Opened from the email's single-use link (`t`), or by a
 * signed-in project manager from Home. Approving or sending back is the manager's decision.
 */

async function view(code: string, id: string) {
  const d = (await listDistributions(code)).find((x) => x.id === id);
  if (!d) throw new HttpError(404, "That distribution is not on this project.");
  return d;
}

export async function GET(req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  const { code: raw, id } = await params;
  const code = decodeURIComponent(raw);
  return handle(async () => {
    const t = new URL(req.url).searchParams.get("t") ?? "";
    if (!(t && (await tokenOpens(code, id, t)))) {
      const v = await requireViewer(req, { allow: (u) => u.fieldAccess !== "none" || mayApprove(u, code) });
      if (v instanceof NextResponse) return t ? NextResponse.json({ error: "This link has been used or has expired. Open the distribution from Home instead." }, { status: 401 }) : v;
      return NextResponse.json({ distribution: await view(code, id), canDecide: mayApprove(v.user, code), canFix: mayFix(v.user, code) });
    }
    return NextResponse.json({ distribution: await view(code, id), canDecide: true, canFix: false });
  });
}

const body = z.object({
  decision: z.enum(["approved", "sent_back", "resubmit"]),
  note: z.string().max(2000).optional(),
  token: z.string().max(200).optional(),
  /** With "resubmit": what was corrected. */
  fix: z.object({ qty: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,29}$/), z.number().min(0).max(1e6)).optional(), signed: z.boolean().optional(), photo: z.boolean().optional() }).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  const { code: raw, id } = await params;
  const code = decodeURIComponent(raw);
  return handle(async () => {
    const b = await readBody(req, body);
    if (b.decision === "resubmit") {
      // The person who recorded it (or anyone who keeps field records here) corrects it and sends it again.
      const v = await requireViewer(req, { write: true, allow: (u) => mayFix(u, code), why: "Only people who record field activities on this project can fix a distribution." });
      if (v instanceof NextResponse) return v;
      await resubmitDistribution(code, id, { id: v.user.id, name: v.user.name }, b.fix ?? {}, b.note ?? "", new URL(req.url).origin);
      return NextResponse.json({ ok: true, decision: "resubmit", distribution: await view(code, id) });
    }
    let by: { id: string; name: string };
    if (b.token && (await tokenOpens(code, id, b.token))) {
      // The link was emailed to the project manager(s); it acts for the first of them.
      const d = await view(code, id);
      const who = (await people()).find((u) => d.notified?.to.includes(u.id));
      by = who ? { id: who.id, name: who.name } : { id: "manager-link", name: "Project manager (email link)" };
    } else {
      const v = await requireViewer(req, { write: true, allow: (u) => mayApprove(u, code), why: "Only the project manager approves input distributions." });
      if (v instanceof NextResponse) return v;
      by = { id: v.user.id, name: v.user.name };
    }
    const r = await decideDistribution(code, id, b.decision, by, b.note);
    return NextResponse.json({ ok: true, ...r, distribution: await view(code, id) });
  });
}
