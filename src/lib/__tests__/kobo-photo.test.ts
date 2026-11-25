import { describe, expect, it } from "vitest";
import { koboAttachment, koboOriginalUrl, koboPhotos, koboPhotoTag, koboPlace, PHOTO_TAGS, TAG_RULES, tagLabels } from "@/lib/kobo-photo";

const att = (name: string, extra: Record<string, unknown> = {}) => ({
  download_url: `https://kf.example.org/api/v2/assets/a1/data/7/attachments/1/?format=json&name=${name}`,
  download_medium_url: `https://kf.example.org/media/medium/${name}`,
  mimetype: "image/jpeg",
  filename: `rop/attachments/a1/uuid-7/${name}`,
  ...extra,
});

describe("where a KoboCollect record was filled in", () => {
  it("uses the phone's own fix when nobody answered a GPS question", () => {
    expect(koboPlace({ start_geopoint: "34.562 69.21 1790 6" })).toEqual({ lat: 34.562, lon: 69.21, from: "device" });
  });

  it("a GPS question answered on purpose wins: at the plot, that is the plot", () => {
    expect(koboPlace({ start_geopoint: "34.5 69.1 0 0", location: "34.562 69.21 1790 6" })).toEqual({ lat: 34.562, lon: 69.21, from: "question" });
  });

  it("falls back to KoboToolbox's own reading, and to nothing", () => {
    expect(koboPlace({ _geolocation: [34.58, 69.19] })).toEqual({ lat: 34.58, lon: 69.19, from: "question" });
    expect(koboPlace({ _geolocation: [null, null] })).toBeNull();
    expect(koboPlace({ start_geopoint: "0 0 0 0" })).toBeNull();
    expect(koboPlace(null)).toBeNull();
  });
});

describe("a KoboCollect photo is tagged by the question it was taken on", () => {
  it("the signed note and the handover on a distribution form", () => {
    expect(koboPhotoTag("distribution", "list_photo")).toBe("signed-note");
    expect(koboPhotoTag("distribution", "handover_photo")).toBe("delivery");
    expect(koboPhotoTag("distribution", "group/signed_note_photo")).toBe("signed-note");
  });

  it("a photo question the forms do not name takes the form's own tag", () => {
    expect(koboPhotoTag("training", "photo")).toBe("training");
    expect(koboPhotoTag("visit", "photo")).toBe("visit");
    expect(koboPhotoTag("readiness", "photo")).toBe("visit");
    expect(koboPhotoTag(null, "photo")).toBeNull();
  });

  it("every tag says which record it belongs to and what happens next", () => {
    for (const t of PHOTO_TAGS) {
      expect(tagLabels[t]).toBeTruthy();
      expect(TAG_RULES[t].record).toBeTruthy();
      expect(TAG_RULES[t].next.endsWith(".")).toBe(true);
    }
  });
});

describe("finding a submission's photo among its attachments", () => {
  it("matches the answer to its file by name, as KoboToolbox stores it", () => {
    const p = { list_photo: "IMG 0042.jpg", _attachments: [att("other.jpg"), att("IMG_0042.jpg")] };
    const a = koboAttachment(p, "list_photo", "distribution")!;
    expect(a.tag).toBe("signed-note");
    expect(a.url).toContain("medium/IMG_0042.jpg");
    expect(koboOriginalUrl(p, "list_photo")).toContain("attachments/1/");
  });

  it("prefers the attachment KoboToolbox says belongs to the question", () => {
    const p = { list_photo: "a.jpg", handover_photo: "a.jpg", _attachments: [att("a.jpg", { question_xpath: "handover_photo", download_medium_url: "https://kf.example.org/m/h.jpg" }), att("a.jpg", { question_xpath: "list_photo", download_medium_url: "https://kf.example.org/m/n.jpg" })] };
    expect(koboAttachment(p, "list_photo")!.url).toContain("/m/n.jpg");
    expect(koboAttachment(p, "handover_photo")!.url).toContain("/m/h.jpg");
  });

  it("an answer whose file has not arrived yet is not a photo", () => {
    expect(koboAttachment({ list_photo: "IMG_1.jpg", _attachments: [] }, "list_photo")).toBeNull();
    expect(koboAttachment({ list_photo: "IMG_1.jpg" }, "list_photo")).toBeNull();
    expect(koboAttachment({ _attachments: [att("IMG_1.jpg")] }, "list_photo")).toBeNull();
  });

  it("lists every answered image question with its tag", () => {
    const p = { farmer: "F-0002", list_photo: "n.jpg", handover_photo: "h.jpg", notes: "fine", _attachments: [att("n.jpg"), att("h.jpg")] };
    expect(koboPhotos(p, "distribution").map((x) => [x.question, x.tag])).toEqual([["list_photo", "signed-note"], ["handover_photo", "delivery"]]);
  });
});
