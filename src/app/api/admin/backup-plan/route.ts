import { NextResponse } from "next/server";
import { z } from "zod";
import { requireViewer } from "@/server/auth";
import { backupStatus, confirmBackupPlan } from "@/server/backup-plan";
import { handle, readBody } from "@/server/guard";
import { orgIdForPerson } from "@/server/org-settings-store";

/** ISS-25: the backup plan, confirmed by an administrator (server/backup-plan). */
export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => !!u.admin, why: "Only administrators see the backup plan." });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await backupStatus(await orgIdForPerson(v.user.id)));
  });
}

const body = z.object({ dailyBackups: z.boolean(), note: z.string().trim().min(5, "Say what you checked, and where.").max(500) });
export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => !!u.admin, why: "Only an administrator confirms the backup plan." });
    if (v instanceof NextResponse) return v;
    const b = await readBody(req, body, "Say whether daily backups are on, and what you checked.");
    return NextResponse.json(await confirmBackupPlan(v.user, b.dailyBackups, b.note));
  });
}
