import { NextResponse } from "next/server";
import { db } from "@/db";
import { overlaps, weeklyPatchSchema } from "@/lib/weekly";
import { logAudit } from "@/server/audit";
import { requireViewer } from "@/server/auth";
import { projectByCode } from "@/server/field-store";
import { handle } from "@/server/guard";
import { loadUpdates } from "@/server/results-store";
import { loadWeekly, mayWriteWeekly, saveWeekly, weeklyView } from "@/server/weekly-store";

type Ctx = { params: Promise<{ code: string }> };

/**
 * The weekly update (?from=2026-10-11 picks a week). Field staff and MEL write it; anyone on the
 * project reads it. Marking a week sent locks it and keeps a copy of what was sent.
 */

const fromOf = (req: Request) => {
  const f = new URL(req.url).searchParams.get("from");
  return f && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : null;
};

export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await weeklyView(code, v.user, fromOf(req)));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: mayWriteWeekly, why: "Only field staff and MEL write the weekly update." });
    if (v instanceof NextResponse) return v;
    const parsed = weeklyPatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form." }, { status: 400 });
    const a = parsed.data;
    const u = v.user;
    const state = await loadWeekly(code);
    const now = new Date().toISOString();
    let from = a.action === "region" ? null : a.from;

    if (a.action === "region") {
      state.region = a.region;
    } else if (a.action === "week") {
      if (a.to < a.from) return NextResponse.json({ error: "The week ends before it starts." }, { status: 400 });
      if ((Date.parse(a.to) - Date.parse(a.from)) / 864e5 > 13) return NextResponse.json({ error: "A weekly update covers two weeks at most." }, { status: 400 });
      const old = a.was ? state.weeks.find((w) => w.from === a.was) : undefined;
      if (a.was && !old) return NextResponse.json({ error: "That week is not saved. Reload the page." }, { status: 409 });
      if (old?.sent) return NextResponse.json({ error: "This week has been sent and can no longer be changed." }, { status: 409 });
      const others = state.weeks.filter((w) => w !== old);
      const clash = others.find((w) => overlaps(w, a));
      if (clash) return NextResponse.json({ error: `These dates overlap update #${clash.n} (${clash.from} to ${clash.to}).` }, { status: 409 });
      if (others.some((w) => w.n === a.n)) return NextResponse.json({ error: `There is already an update #${a.n}.` }, { status: 409 });
      state.weeks = [...others, { n: a.n, from: a.from, to: a.to }];
    } else {
      const w = state.weeks.find((x) => x.from === a.from);
      if (!w) return NextResponse.json({ error: "That week is not saved." }, { status: 404 });
      if (w.sent) return NextResponse.json({ error: "This week has already been marked sent." }, { status: 409 });
      const items = (await loadUpdates(code)).filter((x) => x.date >= w.from && x.date <= w.to);
      if (!items.length) return NextResponse.json({ error: "There is nothing in this week to send." }, { status: 400 });
      // A copy of what was sent, so it can be shown as sent even if the records behind it change.
      w.sent = {
        by: u.id,
        at: now,
        items: items.map((x) => ({ id: x.id, activity: x.activity, ...(x.title ? { title: x.title } : {}), note: x.note, photos: x.files.filter((f) => f.type.startsWith("image/")).map((f) => ({ hash: f.hash, caption: x.captions?.[f.hash] ?? "", ...(x.taken?.[f.hash] ? { taken: x.taken[f.hash] } : {}) })) })),
      };
      from = w.from;
    }
    await saveWeekly(code, state);
    const project = await projectByCode(code);
    await logAudit(db, project.id, { entity: "weekly", entityId: project.id, action: a.action === "send" ? "weekly_sent" : "weekly_edited", by: u.id, detail: a.action === "region" ? { region: a.region } : a.action === "week" ? { n: a.n, from: a.from, to: a.to } : { from: a.from } });
    return NextResponse.json(await weeklyView(code, u, from));
  });
}
