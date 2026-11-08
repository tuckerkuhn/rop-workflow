import { NextResponse } from "next/server";
import { z } from "zod";
import { requireViewer } from "@/server/auth";
import { ask } from "@/server/assistant";
import { handle } from "@/server/guard";
import { aiAllowed } from "@/server/limits";
import { planFor } from "@/server/plans";
import { hasFeature } from "@/lib/plans";
import { DraftingUnavailable } from "@/server/ai-drafts";

const body = z.object({
  question: z.string().trim().min(3, "Ask a question.").max(1000),
  history: z.array(z.object({ q: z.string().max(1000), a: z.string().max(6000) })).max(10).default([]),
});

/** Ask the assistant about this project. Staff only; counted against the AI limits. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee", why: "The assistant is for project staff." });
    if (v instanceof NextResponse) return v;
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ask a question." }, { status: 400 });
    if (!hasFeature(await planFor(v), "ai_assistant")) return NextResponse.json({ error: "The assistant is part of the paid plan." }, { status: 402 });
    const limit = await aiAllowed(v.user.id);
    if (limit) return limit;
    try {
      return NextResponse.json(await ask(code, v.user, parsed.data.question, parsed.data.history));
    } catch (e) {
      if (e instanceof DraftingUnavailable) return NextResponse.json({ error: e.message }, { status: 503 });
      throw e;
    }
  });
}
