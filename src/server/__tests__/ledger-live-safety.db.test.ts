import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { eq } from "drizzle-orm";
import { db, ready, schema as s } from "@/server/__tests__/test-db";
import { accountByCode, expenseAccountFor, postPayment, seedChart } from "@/server/ledger";
import { loadBudget, saveBudget } from "@/server/plan-store";
import { deleteDonor, InputError } from "@/server/progress-store";

/**
 * Migrations 0027 and 0028 against a database shaped like the live one, applied the way drizzle-kit
 * migrate applies them (one transaction, each chunk sent on its own as a single statement), and the
 * existing screens that delete a donor or a budget line once the books name it.
 */

const dir = path.resolve(import.meta.dirname, "../../../drizzle");
const chunks = (file: string) =>
  fs
    .readFileSync(path.join(dir, file), "utf8")
    .split("--> statement-breakpoint")
    .filter((x) => x.trim());

describe("migrations 0027 and 0028 on a database like the live one", { timeout: 120_000 }, () => {
  it("apply statement by statement in one transaction, and the demo reset works with no books yet", async () => {
    const pg = new PGlite();
    await pg.exec("create role anon; create role authenticated; create role service_role;");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files.filter((f) => f < "0027")) for (const c of chunks(f)) await pg.exec(c);
    const org = (await pg.query<{ id: string }>(`insert into organizations (name) values ('Roots of Peace (demo)') returning id`)).rows[0].id;
    for (const [code, kind] of [
      ["A-2027", "real"],
      ["ACRP-2026", "parked"],
      ["GT-2027", "sandbox"],
      ["SFTP-2026", "sandbox"],
      ["SAMPLE-446CEE", "sample"],
    ])
      await pg.query(`insert into projects (organization_id, code, name, country, kind) values ($1, $2, $2, 'AF', $3)`, [org, code, kind]);

    await pg.exec("begin");
    // `query` uses the extended protocol, which refuses two statements in one chunk, as the migrator's driver does.
    for (const f of files.filter((f) => f >= "0027")) for (const c of chunks(f)) await pg.query(c);
    await pg.exec("commit");

    expect((await pg.query<{ d: boolean }>(`select ledger_is_demo_org($1) as d`, [org])).rows[0].d).toBe(true);
    const reset = (await pg.query<{ r: Record<string, unknown> }>(`select ledger_reset_demo('A-2027', 'test') as r`)).rows[0].r;
    expect(reset).toMatchObject({ whole: true, entries: 0 });
    await expect(pg.query(`select ledger_reset_demo('GT-2027', 'test')`)).rejects.toThrow(/real project/);
    // The public API roles cannot call the reset.
    const grants = await pg.query<{ anon: boolean; auth: boolean }>(
      `select has_function_privilege('anon', 'ledger_reset_demo(text, text)', 'execute') as anon, has_function_privilege('authenticated', 'ledger_reset_demo(text, text)', 'execute') as auth`,
    );
    expect(grants.rows[0]).toEqual({ anon: false, auth: false });
    await pg.close();
  });
});

describe("a donor or budget line the books name", { timeout: 60_000 }, () => {
  let donor = "";
  beforeAll(async () => {
    await ready;
    const [org] = await db.insert(s.organizations).values({ name: "Refs Org" }).returning();
    const [project] = await db.insert(s.projects).values({ organizationId: org.id, code: "REF-1", name: "Refs", country: "AF", kind: "sandbox" }).returning();
    [{ id: donor }] = await db.insert(s.donors).values({ organizationId: org.id, projectId: project.id, name: "Refs Donor" }).returning();
    const [line] = await db.insert(s.budgetLines).values({ projectId: project.id, code: "R-1", description: "Seed", amount: "1000.00", currency: "USD", kind: "program" }).returning();
    await db.insert(s.budgetLines).values({ projectId: project.id, code: "R-2", description: "Rent", amount: "500.00", currency: "USD", kind: "operations", sort: 1 });
    await seedChart(org.id);
    const bank = (await accountByCode(org.id, "1010"))!;
    await db.insert(s.bankAccounts).values({ organizationId: org.id, ledgerAccountId: bank.id, name: "Main bank", currency: "USD" });
    const expense = (await expenseAccountFor(org.id, "program"))!;
    await postPayment(
      { organizationId: org.id, recordedBy: "amina", postedBy: "omid", idempotencyKey: "refs-1" },
      { date: "2027-01-10", memo: "Seed", paidFrom: bank.id, currency: "USD", fxRate: "1", projectId: project.id, expenses: [{ accountId: expense.id, amount: "100.00", donorId: donor, projectId: project.id, budgetLineId: line.id }] },
    );
  }, 60_000);

  it("is not removed: the donor stays, with a plain answer", async () => {
    await expect(deleteDonor("REF-1", donor)).rejects.toBeInstanceOf(InputError);
    expect(await db.select().from(s.donors).where(eq(s.donors.id, donor))).toHaveLength(1);
  });

  it("a budget file without the line keeps it, with a plain answer", async () => {
    const budget = await loadBudget("REF-1");
    await expect(saveBudget("REF-1", { ...budget, lines: budget.lines.filter((l) => l.code !== "R-1") })).rejects.toThrow(/Keep those lines/);
    // A line the books do not name can still go.
    await saveBudget("REF-1", { ...budget, lines: budget.lines.filter((l) => l.code !== "R-2") });
    expect((await loadBudget("REF-1")).lines.map((l) => l.code)).toEqual(["R-1"]);
  });
});
