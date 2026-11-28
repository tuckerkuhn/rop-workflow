import { NextResponse } from "next/server";
import { z } from "zod";
import { realToday } from "@/lib/clock";
import { awayInput, DEFAULT_ESCALATE_DAYS } from "@/lib/delegation";
import { people, requireViewer } from "@/server/auth";
import { loadAway, recordAway, removeAway, setEscalateDays } from "@/server/away-store";
import { handle, readBody } from "@/server/guard";

/**
 * Time away and who acts meanwhile (lib/delegation, MF-01). Staff see who is away now and coming
 * up, and who acts for them, so they know where work goes. Each person records their own; an
 * administrator may record anyone's and sets how long work waits before a line manager steps in.
 */
async function view(me: string) {
  const [state, list] = await Promise.all([loadAway(), people()]);
  const today = realToday();
  const name = (id?: string) => list.find((p) => p.id === id)?.name ?? id ?? "";
  return {
    today,
    escalateAfterDays: state.escalateAfterDays ?? DEFAULT_ESCALATE_DAYS,
    entries: state.entries
      .filter((a) => a.to >= today)
      .sort((a, b) => a.from.localeCompare(b.from))
      .map((a) => ({ ...a, personName: name(a.person), delegateName: a.delegate ? name(a.delegate) : null, mine: a.person === me })),
    people: list.filter((p) => p.kind === "employee").map((p) => ({ id: p.id, name: p.name, title: p.title, reportsTo: p.reportsTo ?? null })),
  };
}

export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee", why: "Only staff record time away." });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await view(v.user.id), { headers: { "Cache-Control": "private, no-store" } });
  });
}

const body = z.union([z.object({ action: z.literal("record"), away: awayInput }), z.object({ action: z.literal("remove"), id: z.string().uuid() }), z.object({ action: z.literal("escalate"), days: z.number().int().min(1).max(30) })]);

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee", why: "Only staff record time away." });
    if (v instanceof NextResponse) return v;
    const b = await readBody(req, body, "Give the first and last day away, and who acts for you.");
    if (b.action === "record") await recordAway(b.away, v.actor, await people());
    else if (b.action === "remove") await removeAway(b.id, v.actor);
    else await setEscalateDays(b.days, v.actor);
    return NextResponse.json(await view(v.user.id));
  });
}
