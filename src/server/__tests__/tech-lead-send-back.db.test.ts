import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import { seedDatabase } from "@/server/demo-seed";
import { koboApprovalFor, saveKoboApproval } from "@/server/kobo-approval";
import { loadHome } from "@/server/home-store";
import { GET as listQueue } from "@/app/api/projects/[code]/submissions/route";
import { POST as decideRoute } from "@/app/api/projects/[code]/submissions/[id]/route";
import { ready } from "@/server/__tests__/test-db";

/**
 * The technical lead (Alejandro, senior agronomist) sends field work back for correction with a
 * note. He does not accept field forms (that counts results: MEL, or whoever the project names),
 * does not touch distributions (the project manager), and never sends back his own record.
 */
const code = "A-2027";
let n = 9500;

async function submit(form: "readiness" | "training" | "visit" | "distribution", by = "farida") {
  const [project] = await db.select().from(s.projects).where(eq(s.projects.code, code)).limit(1);
  n += 1;
  const [row] = await db
    .insert(s.evidence)
    .values({ organizationId: project.organizationId, projectId: project.id, source: "kobo", koboAssetUid: `a${form}`, koboSubmissionId: n, koboSubmissionUuid: `uuid-${n}`, form, reviewStatus: "pending", farmerCode: "F-0001", completedBy: by, payload: { _id: n, farmer: "F-0001" } })
    .returning({ id: s.evidence.id });
  return row.id;
}

const post = (as: string, id: string, body: unknown) =>
  decideRoute(new Request(`http://test/api/projects/${code}/submissions/${id}`, { method: "POST", headers: { "x-demo-user": as, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ code, id }) });
const row = async (id: string) => (await db.select().from(s.evidence).where(eq(s.evidence.id, id)).limit(1))[0];
const audits = (id: string) => db.select().from(s.auditLog).where(and(eq(s.auditLog.entity, "evidence"), eq(s.auditLog.entityId, id)));

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);

describe("the technical lead sends field work back", { timeout: 60_000 }, () => {
  it("sends back a pending farm visit with a note, audited and queried like a MEL send-back", async () => {
    const id = await submit("visit");
    const res = await post("alejandro", id, { status: "queried", note: "Spacing looks wrong: measure the rows again." });
    expect(res.status).toBe(200);
    const after = await row(id);
    expect(after.reviewStatus).toBe("queried");
    expect(after.reviewedBy).toBe("alejandro");
    expect(after.queryNote).toBe("Spacing looks wrong: measure the rows again.");
    const log = await audits(id);
    expect(log.map((l) => l.action)).toEqual(["queried"]);
    expect((log[0].detail as { by: string }).by).toBe("alejandro");
  });

  it("does not accept a field form, and says why", async () => {
    const id = await submit("training");
    const res = await post("alejandro", id, { status: "accepted" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/accepts field forms; you can send one back with a note\.$/);
    expect((await row(id)).reviewStatus).toBe("pending");
  });

  it("does not send one back without a note", async () => {
    const id = await submit("readiness");
    const res = await post("alejandro", id, { status: "queried", note: "  " });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/Write a note saying what to fix/);
    expect((await row(id)).reviewStatus).toBe("pending");
    expect(await audits(id)).toHaveLength(0);
  });

  it("does not act on an input distribution", async () => {
    const id = await submit("distribution");
    for (const body of [{ status: "queried", note: "Wrong quantity" }, { status: "accepted" }]) {
      const res = await post("alejandro", id, body);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toMatch(/project manager approves input distributions/);
    }
    expect((await row(id)).reviewStatus).toBe("pending");
  });

  it("does not send back a record he collected himself", async () => {
    const rule = await koboApprovalFor(code);
    await saveKoboApproval(code, { ...rule, accounts: { ...(rule.accounts ?? {}), "alejandro.kobo": "alejandro" } });
    const id = await submit("visit", "alejandro.kobo");
    const res = await post("alejandro", id, { status: "queried", note: "Fix it" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/You collected this record/);
    expect((await row(id)).reviewStatus).toBe("pending");
    // Shown in the queue as nothing he can do.
    const q = await listQueue(new Request(`http://test/api/projects/${code}/submissions`, { headers: { "x-demo-user": "alejandro" } }), { params: Promise.resolve({ code }) });
    const { submissions } = (await q.json()) as { submissions: { dbId?: string; mayDecide: boolean; maySendBack: boolean }[] };
    expect(submissions.find((x) => x.dbId === id)).toMatchObject({ mayDecide: false, maySendBack: false });
    await saveKoboApproval(code, rule);
  });

  it("sees field forms he can send back in the queue and on Home, without a Check row", async () => {
    const id = await submit("visit");
    const q = await listQueue(new Request(`http://test/api/projects/${code}/submissions`, { headers: { "x-demo-user": "alejandro" } }), { params: Promise.resolve({ code }) });
    const { submissions } = (await q.json()) as { submissions: { dbId?: string; mayDecide: boolean; maySendBack: boolean }[] };
    expect(submissions.find((x) => x.dbId === id)).toMatchObject({ mayDecide: false, maySendBack: true });
    const home = await loadHome(code, userById("alejandro")!);
    const keys = home.actions.map((a) => a.key);
    expect(keys).toContain("field-forms-send-back");
    expect(keys).not.toContain("field-forms");
  });

  it("leaves MEL as it was: the stand-in accepts and queries, with no send-back row on Home", async () => {
    const visit = await submit("training");
    const accepted = await post("omar", visit, { status: "accepted" });
    expect(accepted.status).toBe(200);
    expect((await row(visit)).reviewStatus).toBe("accepted");
    const other = await submit("visit");
    const queried = await post("omar", other, { status: "queried", note: "Photo missing" });
    expect(queried.status).toBe(200);
    expect((await row(other)).reviewStatus).toBe("queried");
    const q = await listQueue(new Request(`http://test/api/projects/${code}/submissions`, { headers: { "x-demo-user": "omar" } }), { params: Promise.resolve({ code }) });
    const { submissions } = (await q.json()) as { submissions: { maySendBack: boolean; status: string; form: string }[] };
    expect(submissions.filter((x) => x.status === "pending" && x.form !== "distribution").some((x) => x.maySendBack)).toBe(false);
    const keys = (await loadHome(code, userById("omar")!)).actions.map((a) => a.key);
    expect(keys).toContain("field-forms");
    expect(keys).not.toContain("field-forms-send-back");
  });
});
