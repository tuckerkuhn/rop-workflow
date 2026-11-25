import { describe, expect, it } from "vitest";
import { distanceText, mapEmbed, metresBetween, photoFacts, pointOf } from "@/lib/exif";
import { exifDate } from "@/lib/weekly";
import { exifJpeg } from "./exif-fixture";

describe("what a photo says about itself", () => {
  it("reads the day, the time and the place a phone wrote", () => {
    const f = photoFacts(exifJpeg({ taken: "2026:11:19 10:42:07", gps: { lat: 34.562, lon: 69.21 } }));
    expect(f.date).toBe("2026-11-19");
    expect(f.time).toBe("10:42");
    expect(f.gps!.lat).toBeCloseTo(34.562, 4);
    expect(f.gps!.lon).toBeCloseTo(69.21, 4);
  });

  it("reads south and west as negative, in either byte order", () => {
    for (const littleEndian of [true, false]) {
      const f = photoFacts(exifJpeg({ gps: { lat: -14.6349, lon: -90.5069 }, littleEndian }));
      expect(f.gps!.lat).toBeCloseTo(-14.6349, 4);
      expect(f.gps!.lon).toBeCloseTo(-90.5069, 4);
    }
  });

  it("a photo with no place is not a fault: the day still reads and the place is null", () => {
    const f = photoFacts(exifJpeg({ gps: null }));
    expect(f).toEqual({ date: "2026-11-19", time: "10:42", gps: null });
  });

  it("anything that is not a JPEG with EXIF gives nothing, without throwing", () => {
    expect(photoFacts(new Uint8Array([1, 2, 3]))).toEqual({ date: null, time: null, gps: null });
    expect(photoFacts(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toEqual({ date: null, time: null, gps: null });
    expect(photoFacts(exifJpeg().slice(0, 40))).toEqual({ date: null, time: null, gps: null });
  });

  it("the weekly update's date reader is the same reader", () => {
    const jpg = exifJpeg({ taken: "2027:02:27 08:05:00" });
    expect(exifDate(jpg.buffer.slice(jpg.byteOffset, jpg.byteOffset + jpg.byteLength) as ArrayBuffer)).toBe("2027-02-27");
  });
});

describe("places", () => {
  it("0, 0 and out-of-range values are not places", () => {
    expect(pointOf(0, 0)).toBeNull();
    expect(pointOf("91", "10")).toBeNull();
    expect(pointOf("abc", "10")).toBeNull();
    expect(pointOf("34.5", "69.2")).toEqual({ lat: 34.5, lon: 69.2 });
  });

  it("measures the distance between two points and says it in words", () => {
    const m = metresBetween({ lat: 34.562, lon: 69.21 }, { lat: 34.5623, lon: 69.2101 });
    expect(m).toBeGreaterThan(25);
    expect(m).toBeLessThan(45);
    expect(distanceText(35)).toBe("35 m");
    expect(distanceText(1240)).toBe("1.2 km");
    expect(distanceText(25300)).toBe("25 km");
  });

  it("builds a map address that holds the pin", () => {
    expect(mapEmbed({ lat: 34.562, lon: 69.21 })).toContain("marker=34.56200%2C69.21000");
  });
});
