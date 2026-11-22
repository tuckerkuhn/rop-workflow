import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { userById } from "@/lib/demo";
import type { Farmer, FieldItem } from "@/lib/field";
import { seedDatabase } from "@/server/demo-seed";
import { keepHidden, loadField, projectByCode, saveEdited } from "@/server/field-store";
import { ready } from "@/server/__tests__/test-db";

/** People who may not see farmers' names never read them in a record's text or links, and their saves keep them. */
const code = "A-2027";
const omar = userById("omar")!; // MEL: sees names
const marcus = userById("marcus")!; // VP Programs: does not
let id = "";
let name = "";

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  await projectByCode(code);
  const f = (await loadField(code, omar)).items.find((i): i is Farmer => i.kind === "farmer" && !!i.name)!;
  id = f.id;
  name = f.name;
  const story = { id: "S-T", status: "note" as const, title: `${name} at the river plot`, text: `${name} trained two neighbours.`, date: "2026-11-20", by: "mel", docs: [{ url: `https://x.sharepoint.com/sites/P/${encodeURIComponent(name)}%20interview.docx`, title: "Interview" }, { url: "https://drive.google.com/file/d/abc/view", title: `Photos of ${name}` }] };
  await saveEdited(code, [{ ...f, stories: [...f.stories, story] } as FieldItem]);
}, 120_000);

describe("a farmer's name, for someone who may not see names", { timeout: 60_000 }, () => {
  it("shows as the farmer's number in the text, and a link that names them is left out", async () => {
    const f = (await loadField(code, marcus)).items.find((i): i is Farmer => i.kind === "farmer" && i.id === id)!;
    const s = f.stories.find((x) => x.id === "S-T")!;
    expect(f.name).toBe("");
    expect(JSON.stringify(f)).not.toContain(name);
    expect(s.title).toBe(`Farmer ${id} at the river plot`);
    expect(s.docs?.map((d) => d.title)).toEqual([`Photos of Farmer ${id}`]);
  });

  it("is kept when they save the record unchanged, and their own edits are taken", async () => {
    const shown = (await loadField(code, marcus)).items.find((i): i is Farmer => i.kind === "farmer" && i.id === id)!;
    const edited = { ...shown, stories: shown.stories.map((x) => (x.id === "S-T" ? { ...x, text: `${x.text} Follow up in March.` } : x)) };
    const raw = new Map((await loadField(code)).items.map((i) => [i.id, i]));
    const [back] = (await keepHidden(code, marcus, [edited], raw)) as Farmer[];
    const s = back.stories.find((x) => x.id === "S-T")!;
    expect(s.title).toBe(`${name} at the river plot`);
    expect(s.text).toBe(`${name} trained two neighbours. Follow up in March.`);
    // The link they saw is paired with its own stored link, not with the one hidden from them.
    expect(s.docs?.map((d) => d.title).sort()).toEqual(["Interview", `Photos of ${name}`]);
  });
});
