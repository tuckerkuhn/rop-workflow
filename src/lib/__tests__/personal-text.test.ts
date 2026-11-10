import { describe, expect, it } from "vitest";
import { namesIn, withoutNames } from "@/lib/personal-text";

/** Invented names only. */
describe("names in free text", () => {
  it("finds a possessive name and replaces it", () => {
    expect(namesIn("We visited Zarmal's orchard today.")).toEqual(["Zarmal's"]);
    expect(withoutNames("We visited Zarmal's orchard today.")).toBe("We visited a farmer's orchard today.");
  });
  it("takes a two-word name whole", () => {
    expect(withoutNames("We visited Baryal Noorzad's orchard.")).toBe("We visited a farmer's orchard.");
  });
  it("pinned as it is today: a capitalised word just before the name is taken with it (errs on the safe side)", () => {
    expect(namesIn("Visited Zarmal's orchard today.")).toEqual(["Visited Zarmal's"]);
    expect(withoutNames("Visited Zarmal's orchard today.")).toBe("a farmer's orchard today.");
  });
  it("finds a village and replaces it", () => {
    expect(namesIn("Training held in Sorkhab Village.")).toEqual(["Sorkhab Village"]);
    expect(withoutNames("Training held in Sorkhab Village.")).toBe("Training held in a village.");
  });
  it("finds a titled name and replaces title and name together", () => {
    expect(namesIn("Met Haji Baryal Noorzad at the site.")).toEqual(["Haji Baryal Noorzad"]);
    expect(withoutNames("Met Haji Baryal Noorzad at the site.")).toBe("Met a farmer at the site.");
  });
  it("keeps provinces, donors and months", () => {
    const text = "Kandahar's farmers met UNDP in March. Helmand's canal was cleaned.";
    expect(namesIn(text)).toEqual([]);
    expect(withoutNames(text)).toBe(text);
  });
  it("replaces every name in a note, not only the first", () => {
    const out = withoutNames("Zarmal's plot and Torpekai's plot are in Sorkhab Village and Spinkai Kalay.");
    expect(out).toBe("a farmer's plot and a farmer's plot are in a village and a village.");
    expect(out).not.toMatch(/Zarmal|Torpekai|Sorkhab|Spinkai/);
  });
  it("gives the same answer when called twice (no state kept between calls)", () => {
    const t = "Mr. Baryal showed Zarmal's trellis.";
    expect(withoutNames(t)).toBe(withoutNames(t));
    expect(namesIn(t)).toEqual(namesIn(t));
  });
  it("known limit, pinned: a bare name with no title, possessive or village is not caught", () => {
    expect(withoutNames("Baryal attended the training.")).toBe("Baryal attended the training.");
  });
  it("known limit, pinned: names in Dari or Pashto script are not caught", () => {
    const t = "باغ احمد";
    expect(withoutNames(t)).toBe(t);
  });
});
