import { NextResponse } from "next/server";
import { realToday } from "@/lib/clock";
import { stampHistory } from "@/lib/history";
import { EMPTY_VOUCHER_SETUP, VOUCHER_SETUP_KEY, type VoucherSetup } from "@/lib/voucher-setup";
import { loadProjectState } from "@/server/project-state";
import { actOnPlan } from "@/server/procurement-plan-store";
import { z } from "zod";
import { procRolesFor, type Procurement } from "@/lib/procurement";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { claimNewProcurements, loadProcurements, procurementIdsOfOrg, releaseNewProcurements, saveProcurements } from "@/server/procurement-store";
import { db } from "@/db";
import { logAudit } from "@/server/audit";
import { projectByCode, setupOf } from "@/server/field-store";
import { applyProcurementContext, describeProcurementSave, loadProcurementContext, validateProcurementSave } from "@/server/procurement-guard";
import { loadPlan } from "@/server/procurement-plan-store";
import { loadGrantBook } from "@/server/grants-store";
import { orgIdForPerson } from "@/server/org-settings-store";

/** The project's procurements. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.procurementAccess !== "none" });
    if (v instanceof NextResponse) return v;
    // The budget lines the Field input package draws from: goods on them are handed out farmer by
    // farmer in Field activities, and each approved distribution is added to the purchase's list.
    const setup = await setupOf(await projectByCode(code)).catch(() => null);
    const packageLines = [...new Set((setup?.items ?? []).map((i) => i.budgetLine).filter(Boolean))];
    // The voucher coding set in project setup (lib/voucher-setup): a new voucher starts from it.
    const coding = await loadProjectState<VoucherSetup>((await projectByCode(code)).id, VOUCHER_SETUP_KEY, EMPTY_VOUCHER_SETUP);
    return NextResponse.json({ items: await loadProcurements(code), packageLines, coding });
  });
}

const bodySchema = z.object({
  items: z.array(z.object({ id: z.string().regex(/^[A-Z0-9-]{3,40}$/), step: z.string().min(1), title: z.string() }).passthrough()).max(200),
});

/** Saves the procurements that changed. */
export async function PUT(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    // R2-01: someone the approval table names to sign (the CEO above $25,000, management) may sign with
    // view access only; the guard below lets them change nothing but the step they own.
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee", why: "You can view Procurement but not change it." });
    if (v instanceof NextResponse) return v;
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "That procurement could not be saved: the record is incomplete." }, { status: 400 });
    const items = parsed.data.items as unknown as Procurement[];
    // On a real project a goods received note is never dated after today: a later date would read as
    // a sample record and switch off the stock-by-date check (code review of ISS-16).
    const thisProject = await projectByCode(code);
    if (thisProject.kind === "real") {
      const now = realToday();
      const grnDates = (p: Procurement) => [...(p.signatures?.["Goods received note"] ?? []), ...(p.payments ?? []).flatMap((r) => r.signatures?.["Goods received note"] ?? [])].map((x) => (x.date ?? "").slice(0, 10));
      const ahead = items.find((x) => grnDates(x).some((d) => d > now));
      if (ahead) return NextResponse.json({ error: `${ahead.id}: a goods received note cannot be dated after today. Date it the day the goods arrived.` }, { status: 400 });
    }
    // The server decides what is allowed (the same rules as the screen), then records each save.
    // Everything is loaded first; the checks then run with no await in between, so another
    // request cannot swap in its own project's rules while these run.
    const storedList = await loadProcurements(code);
    const stored = new Map(storedList.map((p) => [p.id, p]));
    const merged = [...storedList.filter((p) => !items.some((x) => x.id === p.id)), ...items];
    const [ctx, calendar] = await Promise.all([
      loadProcurementContext(code, await orgIdForPerson(v.user.id), merged),
      // Every project's new requests charge its procurement calendar, the demo project's too (R2-05):
      // it is where people learn the workflow. Its sample records keep their sample lines.
      loadPlan(code),
    ]);
    // A new request's number must be free across the organization, not only on this project (ISS-11).
    const fresh = items.filter((x) => !stored.has(x.id));
    if (fresh.length) {
      const here = await projectByCode(code);
      const elsewhere = new Set((await procurementIdsOfOrg(here.organizationId)).filter((r) => r.projectId !== here.id).map((r) => r.id));
      const clash = fresh.find((x) => elsewhere.has(x.id));
      if (clash) return NextResponse.json({ error: `${clash.id} is already the number of a purchase on another project. Start the request again: it will take the next free number.` }, { status: 409 });
    }
    // Someone else saved since this copy was loaded: refuse, and the screen reloads the latest.
    const stale = items.find((x) => stored.has(x.id) && (stored.get(x.id)!.rev ?? 0) !== (x.rev ?? 0));
    if (stale) return NextResponse.json({ error: `${stale.id} was changed by someone else just now. The latest copy is loaded; make your change again.`, stale: true }, { status: 409 });
    // AI check findings are written only by the AI check (procurements/[id]/check): a screen's save
    // never removes or changes them, even when its copy was taken before the check came back.
    for (const x of items) {
      const prev = stored.get(x.id);
      if (prev) x.ai = prev.ai;
      else delete x.ai;
    }
    applyProcurementContext(ctx);
    if (v.user.procurementAccess !== "edit" && !procRolesFor(v.user).length) return NextResponse.json({ error: "You can view Procurement but not change it." }, { status: 403 });
    for (const next of items) {
      const why = validateProcurementSave(stored.get(next.id), next, v.user, calendar, ctx.register, merged);
      if (why) return NextResponse.json({ error: `${next.id}: ${why}` }, { status: 409 });
    }
    // A request made for an in-kind grant keeps that grant; the grant must be this project's, open and in kind.
    const withGrant = items.filter((x) => (x.grant ?? null) !== (stored.get(x.id)?.grant ?? null));
    if (withGrant.length) {
      const grants = (await loadGrantBook(code)).items;
      for (const x of withGrant) {
        if (stored.has(x.id)) return NextResponse.json({ error: `${x.id}: the grant a request is for is fixed when the request is made.` }, { status: 409 });
        const g = grants.find((y) => y.id === x.grant);
        if (!g || g.type !== "inKind" || g.status !== "open") return NextResponse.json({ error: `${x.id}: ${x.grant} is not an open in-kind grant on this project.` }, { status: 409 });
      }
    }
    // Take the new numbers first: of two people saving the same new number at once, the second is
    // told it is taken instead of overwriting the first request.
    const claimed = fresh.map((x) => ({ ...x, rev: 1 }));
    const taken = await claimNewProcurements(code, claimed);
    if (taken.length) {
      await releaseNewProcurements(code, claimed.filter((x) => !taken.includes(x.id)).map((x) => x.id));
      return NextResponse.json({ error: `${taken[0]} was just taken by another request. Start the request again: it will take the next free number.` }, { status: 409 });
    }
    // A new request made from the calendar starts that calendar item here, with the save: the two
    // never disagree (an item marked started with no request, or a request on an item still open).
    if (calendar)
      for (const x of items.filter((y) => !stored.has(y.id) && y.plan)) {
        const item = calendar.find((i) => i.key === x.plan!.key);
        if (item?.status !== "approved") continue;
        const r = await actOnPlan(code, item.key, { action: "start", procurementKey: x.id }, v.user);
        if ("error" in r) {
          await releaseNewProcurements(code, claimed.map((y) => y.id));
          return NextResponse.json({ error: `${x.id}: ${r.error}` }, { status: 409 });
        }
      }
    // Each new history entry gets the time it was saved; older ones keep theirs (lib/history).
    const now = new Date();
    const saved = items.map((x) => ({ ...x, timeline: stampHistory(stored.get(x.id)?.timeline, x.timeline ?? [], now), rev: (stored.get(x.id)?.rev ?? 0) + 1 }));
    await saveProcurements(code, saved);
    const project = await projectByCode(code);
    for (const next of items) await logAudit(db, project.id, { entity: "procurement", entityId: project.id, action: "procurement_saved", by: v.user.id, detail: describeProcurementSave(stored.get(next.id), next) });
    return NextResponse.json({ ok: true, revs: Object.fromEntries(saved.map((x) => [x.id, x.rev])) });
  });
}
