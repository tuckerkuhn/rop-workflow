import { NextResponse } from "next/server";
import { z } from "zod";
import { receiptCheckSchema } from "@/lib/receipt-check";
import { people, requireViewer } from "@/server/auth";
import { checkKoboDistribution, decideDistribution, listDistributions, mayApprove, mayFix, resubmitDistribution, signedNotePhoto, tokenOpens } from "@/server/distribution";
import { farmerNameOf, projectByCode } from "@/server/field-store";
import { handle, HttpError, readBody } from "@/server/guard";
import type { AppUser } from "@/lib/demo";

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

/** The signed note's photo for the approver to see; app records only (lib/field Photo.signedNote). */
const noteOf = (code: string, d: { source?: string; farmerId: string }) => (d.source === "kobo" ? Promise.resolve(null) : signedNotePhoto(code, d.farmerId));

/** The farmer's name for the title, only for a signed-in viewer who may see names (pii); null for anyone else. */
const nameFor = async (code: string, farmerId: string, user: AppUser | null) => (user?.pii ? farmerNameOf((await projectByCode(code)).id, farmerId, user) : null);

export async function GET(req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  const { code: raw, id } = await params;
  const code = decodeURIComponent(raw);
  return handle(async () => {
    const t = new URL(req.url).searchParams.get("t") ?? "";
    if (!(t && (await tokenOpens(code, id, t)))) {
      // Field staff and approvers open it, and whoever checks this KoboCollect record.
      const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
      if (v instanceof NextResponse) return t ? NextResponse.json({ error: "This link has been used or has expired. Open the distribution from Home instead." }, { status: 401 }) : v;
      const all = await listDistributions(code);
      const d = all.find((x) => x.id === id);
      if (!d) throw new HttpError(404, "That distribution is not on this project.");
      const canCheckKobo = d.koboCheck.who.includes(v.user.id);
      // Its approvers are worked out on the record: managers, never whoever recorded or collected it.
      const canDecide = mayApprove(v.user, code) && d.approvers.includes(v.user.id);
      if (v.user.fieldAccess === "none" && !canDecide && !canCheckKobo) throw new HttpError(403, "Your role does not open input distributions on this project.");
      // The others waiting for this person, oldest first, so the page can go straight to the next one.
      const waiting = all
        .filter((x) => x.id !== id && x.status === "pending" && (canDecide ? !x.koboCheck.needed && x.approvers.includes(v.user.id) : x.koboCheck.needed && x.koboCheck.who.includes(v.user.id)))
        .reverse()
        .map((x) => ({ id: x.id, farmerId: x.farmerId }));
      return NextResponse.json({ distribution: d, farmerName: await nameFor(code, d.farmerId, v.user), notePhoto: await noteOf(code, d), canDecide, canFix: mayFix(v.user, code), canCheckKobo, waiting: canDecide || canCheckKobo ? waiting : [] });
    }
    const d = await view(code, id);
    // The photo can show farmers' names, so the email link alone does not open it: only a signed-in employee sees it.
    const signedIn = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    const photo = await noteOf(code, d);
    const shown = signedIn instanceof NextResponse ? null : photo;
    const farmerName = signedIn instanceof NextResponse ? null : await nameFor(code, d.farmerId, signedIn.user);
    return NextResponse.json({ distribution: d, farmerName, notePhoto: shown, photoNeedsSignIn: !!photo && !shown, canDecide: true, canFix: false });
  });
}

const body = z.object({
  decision: z.enum(["approved", "sent_back", "resubmit", "kobo_checked"]),
  note: z.string().max(2000).optional(),
  token: z.string().max(200).optional(),
  /** With "approved" (needed) or "sent_back": what the distribution receipt shows (lib/receipt-check). */
  receipt: receiptCheckSchema.optional(),
  /** With "resubmit": what was corrected. */
  fix: z.object({ qty: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,29}$/), z.number().min(0).max(1e6)).optional(), signed: z.boolean().optional(), photo: z.boolean().optional(), conditionOk: z.boolean().optional() }).optional(),
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
    if (b.decision === "kobo_checked") {
      // The check on a KoboCollect record, by whoever this project names for KoboCollect data.
      // Who may check is decided on the record itself: the project's approvers, never its collector.
      const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee", why: "Only staff can check this record." });
      if (v instanceof NextResponse) return v;
      await checkKoboDistribution(code, id, { id: v.user.id, name: v.user.name }, new URL(req.url).origin);
      return NextResponse.json({ ok: true, decision: "kobo_checked", distribution: await view(code, id) });
    }
    let by: { id: string; name: string };
    const opened = b.token ? await tokenOpens(code, id, b.token) : null;
    if (opened) {
      // Each manager is emailed their own link, so the decision is recorded under the one who used
      // it. An older record had one link for all its managers: that acts for the first of them.
      const d = await view(code, id);
      const who = (await people()).find((u) => (opened.who ? u.id === opened.who : d.notified?.to.includes(u.id)));
      by = who ? { id: who.id, name: who.name } : { id: "manager-link", name: "Project manager (email link)" };
    } else {
      const v = await requireViewer(req, { write: true, allow: (u) => mayApprove(u, code), why: "Only staff on this project approve input distributions." });
      if (v instanceof NextResponse) return v;
      by = { id: v.user.id, name: v.user.name };
    }
    const r = await decideDistribution(code, id, b.decision, by, b.note, b.receipt);
    return NextResponse.json({ ok: true, ...r, distribution: await view(code, id) });
  });
}
