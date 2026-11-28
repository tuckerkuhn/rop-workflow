import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));
// Emails are caught, not sent: the test reads the link out of them.
const sent: { to: string; text: string }[] = [];
vi.mock("@/server/notify-store", () => ({ send: async (to: string, mail: { text: string }) => void sent.push({ to, text: mail.text }) }));

import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import type { Farmer } from "@/lib/field";
import { seedDatabase } from "@/server/demo-seed";
import { recordFromApp, tokenOpens } from "@/server/distribution";
import { loadField } from "@/server/field-store";
import { loadProcurements, saveProcurements } from "@/server/procurement-store";
import { approveAs } from "@/server/__tests__/receipt-helper";
import { ready } from "@/server/__tests__/test-db";

// As the screen and the field route require before a distribution is recorded: the recipient's
// signature or thumbprint is confirmed. Without it the distribution cannot be approved.
const handedOut = (f: Farmer): Farmer => ({ ...f, photos: [...f.photos, { id: "note", activity: "distribution" as const, date: "2027-01-01", caption: "Signed goods received note", src: "data:image/png;base64,AA==", signedNote: true }], checks: { ...f.checks, "distribute.recipient": true }, step: "plant" });


/** The emailed approval link: one per manager, opens once, and says whose it is. */
const code = "A-2027";
const bilal = userById("bilal")!;
const nadia = userById("nadia")!;
let id = "";
const tokenIn = (text: string) => new URL(text.split("\n").at(-1)!).searchParams.get("t")!;

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  process.env.NOTIFY_TEST_TO = "test-inbox@example.org";
  process.env.RESEND_API_KEY = "not-a-real-key";
  await ready;
  await seedDatabase();
  const p = (await loadProcurements(code)).find((x) => x.id === "PR-2027-011")!;
  await saveProcurements(code, [{ ...p, step: "package" }]);
  const f = (await loadField(code, bilal)).items.find((i) => i.id === "F-0007") as Farmer;
  id = await recordFromApp(code, handedOut(f), bilal, "https://app.test");
}, 120_000);

describe("the emailed approval link", { timeout: 60_000 }, () => {
  it("goes to the project manager with their own link, never a farmer's name", async () => {
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("test-inbox@example.org");
    expect(sent[0].text).toContain(`https://app.test/approve/A-2027/${id}?t=`);
    expect(sent[0].text).toContain("F-0007");
    const [pii] = await db.select({ name: s.farmerPii.fullName }).from(s.farmerPii).innerJoin(s.farmers, eq(s.farmers.id, s.farmerPii.farmerId)).where(eq(s.farmers.code, "F-0007"));
    expect(pii.name.length).toBeGreaterThan(3);
    expect(sent[0].text).not.toContain(pii.name);
    for (const part of pii.name.split(" ")) expect(sent[0].text).not.toContain(part);
  });

  it("opens the distribution as that manager; a wrong link opens nothing", async () => {
    expect(await tokenOpens(code, id, tokenIn(sent[0].text))).toEqual({ who: "nadia" });
    expect(await tokenOpens(code, id, "not-the-token")).toBeNull();
    expect(await tokenOpens(code, id, "")).toBeNull();
  });

  it("keeps only the link's fingerprint, not the link", async () => {
    const [row] = await db.select().from(s.projectState).where(eq(s.projectState.key, "distributions"));
    expect(JSON.stringify(row.data)).not.toContain(tokenIn(sent[0].text));
  });

  it("stops working once the distribution is decided", async () => {
    await approveAs(code, id, { id: nadia.id, name: nadia.name });
    expect(await tokenOpens(code, id, tokenIn(sent[0].text))).toBeNull();
  });
});
