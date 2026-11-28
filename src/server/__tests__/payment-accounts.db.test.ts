import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import { accountFlags } from "@/lib/payment-accounts";
import { ready } from "@/server/__tests__/test-db";
import { seedDatabase } from "@/server/demo-seed";
import { moneyAccounts, setUpBankAndCash } from "@/server/ledger-setup";
import { decideAccount, loadAccounts, proposeAccount } from "@/server/payment-accounts-store";

/** MF-06 (Q3 audit finding 2): accounts only in the organization's name; two people to add or change one; cash flagged. */
let org = "";
let orgName = "";
beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  const [o] = await db.select().from(s.organizations).limit(1);
  org = o.id;
  orgName = o.name;
  await setUpBankAndCash(org, "yusuf");
}, 120_000);

describe("the payment accounts register", { timeout: 60_000 }, () => {
  it("refuses an account in a person's name; a change takes effect only when someone else confirms it", async () => {
    const [bank, cash] = [(await moneyAccounts(org)).find((m) => m.code === "1010")!, (await moneyAccounts(org)).find((m) => m.code === "1000")!];
    const yusuf = userById("yusuf")!;
    const omid = userById("omid")!;
    expect(accountFlags(undefined)[0]).toMatch(/Not in the payment accounts register/);
    await expect(proposeAccount(org, { account: bank.bankAccountId, owner: "Yusuf Mohammadi", type: "bank", institution: "AIB", signatories: ["yusuf"] }, "Opening the project account", yusuf)).rejects.toThrow(/in its own name/);
    await expect(proposeAccount(org, { account: bank.bankAccountId, owner: orgName, type: "bank", institution: "AIB", last4: "1234", signatories: ["yusuf", "karim"] }, "Opening the project account", userById("farida")!)).rejects.toThrow(/Only Finance/);
    const c = await proposeAccount(org, { account: bank.bankAccountId, owner: orgName, type: "bank", institution: "AIB", last4: "1234", signatories: ["yusuf", "karim"] }, "Opening the project account", yusuf);
    expect((await loadAccounts(org)).accounts[bank.bankAccountId]).toBeUndefined();
    await expect(decideAccount(org, c.id, true, yusuf)).rejects.toThrow(/second person confirms/);
    await decideAccount(org, c.id, true, omid);
    expect((await loadAccounts(org)).accounts[bank.bankAccountId]).toMatchObject({ owner: orgName, type: "bank", proposedBy: "yusuf", confirmedBy: "omid" });

    const k = await proposeAccount(org, { account: cash.bankAccountId, owner: orgName, type: "cash", signatories: ["yusuf"] }, "Petty cash box at the office", omid);
    await decideAccount(org, k.id, true, yusuf);
    expect(accountFlags((await loadAccounts(org)).accounts[cash.bankAccountId])[0]).toMatch(/^Cash/);
    const logged = await db.select().from(s.auditLog).where(eq(s.auditLog.action, "payment_account_confirmed"));
    expect(logged.length).toBe(2);
  });
});
