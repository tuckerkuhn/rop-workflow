import { NextResponse } from "next/server";
import { foldRecruitment, panelScore, recActionSchema, type Vacancy } from "@/lib/recruitment";
import { people, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { append, loadHr, todayIso } from "@/server/hr-store";

/**
 * Recruitment (lib/recruitment, MF-05). HR sees every vacancy; a panel member sees the vacancies
 * they sit on, to score the shortlist. Candidates' names stay with HR and the panel.
 */
async function view(me: string) {
  const { state: hr, entries } = await loadHr();
  const isHr = !!hr.rules?.holders.hr.includes(me);
  const { vacancies } = foldRecruitment(entries, hr);
  const names = Object.fromEntries((await people()).map((u) => [u.id, u.name]));
  const shown = vacancies.filter((v) => isHr || v.panel.includes(me));
  const out = (v: Vacancy) => ({
    ...v,
    panelNames: v.panel.map((p) => names[p] ?? p),
    candidates: v.candidates
      .filter((c) => isHr || v.shortlist.includes(c.n))
      .map((c) => ({ ...c, score: panelScore(v, c), myScore: c.scores[me] ?? null, scores: isHr ? c.scores : {} })),
  });
  return { me, isHr, today: todayIso(), staff: Object.values(hr.people).filter((p) => !p.separated).map((p) => ({ id: p.id, name: names[p.id] ?? String(p.current.name ?? p.id), grade: typeof p.current.grade === "number" ? p.current.grade : null })), vacancies: shown.sort((a, b) => b.n - a.n).map(out) };
}
export type RecruitmentView = Awaited<ReturnType<typeof view>>;

export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await view(v.user.id), { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const parsed = recActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    const { action, ...data } = parsed.data;
    const n = await append(v.user.id, `rec-${action}`, null, data);
    const after = await loadHr();
    const bad = foldRecruitment(after.entries, after.state).ignored.find((x) => x.n === n);
    if (bad) return NextResponse.json({ error: `Recorded as entry ${n} but it does not count: ${bad.why}.` }, { status: 409 });
    return NextResponse.json(await view(v.user.id));
  });
}
