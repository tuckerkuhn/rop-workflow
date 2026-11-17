import { NextResponse } from "next/server";
import { z } from "zod";
import { canEditProject } from "@/lib/demo";
import { onProject } from "@/server/auth";
import { guard, handle, HttpError, readBody } from "@/server/guard";
import { copySetup, templateSources } from "@/server/project-template";

type Ctx = { params: Promise<{ code: string }> };
const mayCopy = (u: Parameters<typeof canEditProject>[0]) => canEditProject(u);

/** The projects this project's setup can be started from. */
export async function GET(req: Request, { params }: Ctx) {
  const code = decodeURIComponent((await params).code);
  return handle(async () => {
    const v = await guard(req, { allow: (u) => u.kind === "employee" });
    return NextResponse.json({ sources: await templateSources(v.user, code), canCopy: mayCopy(v.user) });
  });
}

const body = z.object({ from: z.string().trim().regex(/^[A-Za-z0-9-]{2,40}$/) });

/**
 * Starts this project from another project's setup (lib/project-template): its input package as a
 * draft, who approves KoboCollect data, and its targets, each only where this project has none.
 */
export async function POST(req: Request, { params }: Ctx) {
  const code = decodeURIComponent((await params).code);
  return handle(async () => {
    const v = await guard(req, { write: true, allow: (u) => u.kind === "employee" && mayCopy(u), why: "Only the project manager and plan approvers can set a project up." });
    const b = await readBody(req, body, "Choose the project to start from.");
    // Only from a project this person works on: its setup is not shown to anyone else.
    if (!onProject(v.user, b.from)) throw new HttpError(403, `You do not work on ${b.from}, so its setup cannot be copied by you.`);
    return NextResponse.json(await copySetup(b.from, code, v.user));
  });
}
