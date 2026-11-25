import JSZip from "jszip";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { earlyDraftLine, periodNotEnded } from "@/lib/early-draft";
import { periodDocx } from "@/lib/period-docx";
import { qprDocx, type DocxInput } from "@/lib/qpr-docx";
import { seedDatabase } from "@/server/demo-seed";
import { projectByCode } from "@/server/field-store";
import { periodReport } from "@/server/period-report-store";
import { addCopy, copyOf, qprData } from "@/server/qpr-store";
import { donorSafeReport } from "@/server/share-store";
import { ready } from "@/server/__tests__/test-db";

/**
 * Decision X, 25 Nov 2026: a report may be released before its period ends, and until the period
 * has ended it carries a "Draft" watermark: on its page, in its Word file and on a donor's link.
 */
const code = "A-2027";
const quarter = "2026-Q4";

/** The words of a Word file: its pages, and the head of every page. */
async function wordsOf(blob: Blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const text = async (name: string) => (await zip.file(name)!.async("string")).replace(/<[^>]+>/g, " ");
  const heads = Object.keys(zip.files).filter((f) => /^word\/header\d*\.xml$/.test(f));
  return { body: await text("word/document.xml"), head: (await Promise.all(heads.map(text))).join(" ") };
}

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);

describe("a report whose period has not ended", { timeout: 60_000 }, () => {
  it("is a draft up to and on the period's last day, and not from the day after", () => {
    expect(periodNotEnded("2026-12-31", "2026-11-25")).toBe(true);
    expect(periodNotEnded("2026-12-31", "2026-12-31")).toBe(true);
    expect(periodNotEnded("2026-12-31", "2027-01-01")).toBe(false);
    expect(earlyDraftLine("2026-12-31")).toBe("Draft. The period this report covers ends on 31 December 2026. Until then it is not the final report.");
  });

  it("the quarterly report's Word file says Draft at the head of every page and on the cover, until the period has ended", async () => {
    const d = { ...(await qprData(code, quarter)), origin: "http://test" } as unknown as DocxInput;
    const early = await wordsOf(await qprDocx({ ...d, today: "2026-11-25" }, new Map()));
    expect(early.head).toContain("DRAFT");
    expect(early.body).toContain("Draft. The period this report covers ends on 31 December 2026.");
    const lastDay = await wordsOf(await qprDocx({ ...d, today: "2026-12-31" }, new Map()));
    expect(lastDay.head).toContain("DRAFT");
    const after = await wordsOf(await qprDocx({ ...d, today: "2027-01-01" }, new Map()));
    expect(after.head).not.toContain("DRAFT");
    expect(after.body).not.toContain("Draft. The period this report covers");
  });

  it("the annual report's Word file does the same", async () => {
    const v = await periodReport(code, { kind: "annual", year: 2026 });
    const early = await wordsOf(await periodDocx(v, "http://test", 0, "2026-11-25"));
    expect(early.head).toContain("DRAFT");
    expect(early.body).toContain("Draft. The period this report covers ends on 31 December 2026.");
    const after = await wordsOf(await periodDocx(v, "http://test", 0, "2027-01-01"));
    expect(after.head).not.toContain("DRAFT");
    expect(after.body).not.toContain("Draft. The period this report covers");
  });

  it("a donor's link and a donor's account are told the period's last day, so they can carry the watermark", async () => {
    const d = await qprData(code, quarter);
    const copy = { kind: "release" as const, by: "marcus", at: "2026-11-25T10:00:00.000Z", work: { minutes: 0, sittings: 0, first: null, last: null }, data: copyOf(d) };
    await addCopy(code, quarter, copy);
    const seen = await donorSafeReport(code, (await projectByCode(code)).id, quarter, copy);
    expect(seen.period).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(periodNotEnded(seen.period.to, "2026-11-25")).toBe(true);
  });
});
