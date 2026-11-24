import { beforeEach, describe, expect, it } from "vitest";
import { cachedHome, forgetHome, homeCacheKey, keepHome } from "@/components/home/home-cache";

/** Home's kept answers (components/home/home-cache): the last one at once, and never someone else's. */
describe("Home's kept answers", () => {
  beforeEach(() => forgetHome());
  const home = (who: string, project = "A-2027") => homeCacheKey(who, who, `/api/projects/${project}/home?with=next-report`);

  it("gives back the last answer for the same person, project and address", () => {
    expect(cachedHome(home("nadia"))).toBeUndefined();
    keepHome(home("nadia"), { n: 1 });
    keepHome(home("nadia"), { n: 2 });
    expect(cachedHome(home("nadia"))).toEqual({ n: 2 });
    expect(cachedHome(home("nadia", "B-2027"))).toBeUndefined();
  });

  it("drops everything when another person reads, so no one sees another person's answer", () => {
    keepHome(home("nadia"), { n: 1 });
    expect(cachedHome(home("omar"))).toBeUndefined();
    // Coming back as Nadia later reads afresh: her answer went when Omar's screens were asked for.
    expect(cachedHome(home("nadia"))).toBeUndefined();
  });

  it("keeps an administrator's own screens apart from the person they view as", () => {
    keepHome(homeCacheKey("tucker", "nadia", "/api/week?day=2026-11-23"), { as: "nadia" });
    expect(cachedHome(homeCacheKey("nadia", "nadia", "/api/week?day=2026-11-23"))).toBeUndefined();
    expect(cachedHome(homeCacheKey("tucker", "nadia", "/api/week?day=2026-11-23"))).toBeUndefined();
  });

  it("forgets everything at sign-out or after a change", () => {
    keepHome(home("nadia"), { n: 1 });
    forgetHome();
    expect(cachedHome(home("nadia"))).toBeUndefined();
  });

  it("keeps a bounded number of answers, the oldest going first", () => {
    for (let i = 0; i < 30; i++) keepHome(home("nadia", `P-${i}`), { i });
    expect(cachedHome(home("nadia", "P-0"))).toBeUndefined();
    expect(cachedHome(home("nadia", "P-29"))).toEqual({ i: 29 });
  });
});
