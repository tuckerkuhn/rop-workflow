import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { userById } from "@/lib/demo";
import type { Farmer, FieldItem } from "@/lib/field";
import { ready } from "@/server/__tests__/test-db";
import { seedDatabase } from "@/server/demo-seed";
import { loadField, saveEdited } from "@/server/field-store";
import { storiesView, storyAction } from "@/server/stories-store";

/** A story on a farmer's profile, written up on the Success stories page (server/stories-store "from-farmer"). */
const code = "A-2027";
const omar = userById("omar")!; // MEL: sees names, writes stories
let farmer: Farmer;

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  const f = (await loadField(code, omar)).items.find((i): i is Farmer => i.kind === "farmer" && !!i.name)!;
  const story = { id: "S-P", status: "completed" as const, title: `${f.name} sells at the market`, text: `${f.name} sold the first harvest in Jalalabad.`, date: "2026-11-20", by: "mel", docs: [{ url: `https://x.sharepoint.com/sites/P/${encodeURIComponent(f.name)}.docx`, title: "Interview" }, { url: "https://drive.google.com/file/d/abc/view", title: "Photos" }] };
  await saveEdited(code, [{ ...f, stories: [...f.stories, story] } as FieldItem]);
  farmer = f;
}, 120_000);

describe("a farmer's story, written up as a success story", { timeout: 60_000 }, () => {
  it("becomes one draft, linked to the farmer, with the name hidden and links that name them left out", async () => {
    const first = await storyAction(code, omar, { action: "from-farmer", farmer: farmer.id, story: "S-P" });
    expect(first.error).toBeUndefined();
    const again = await storyAction(code, omar, { action: "from-farmer", farmer: farmer.id, story: "S-P" });
    expect(again.id).toBe(first.id);
    const s = (await storiesView(code, omar)).stories.find((x) => x.id === first.id)!;
    expect(s.status).toBe("draft");
    expect(s.farmer).toEqual({ id: farmer.id, story: "S-P" });
    expect(s.title).toBe(`Farmer ${farmer.id} sells at the market`);
    expect(JSON.stringify(s)).not.toContain(farmer.name.split(" ")[0]);
    expect(s.consent).toBeNull();
    expect(s.docs?.map((d) => d.title)).toEqual(["Photos"]);
  });

  it("says so when the story is not on the profile", async () => {
    expect((await storyAction(code, omar, { action: "from-farmer", farmer: farmer.id, story: "S-NONE" })).error).toMatch(/not on the farmer's profile/);
  });
});
