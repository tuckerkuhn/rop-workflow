import { describe, expect, it } from "vitest";
import { duplicatesText, nameKey, phoneKey, possibleDuplicates } from "@/lib/duplicates";
import { parseFarmers } from "@/lib/farmer-import";

/** MF-08: a farmer registered twice is found by phone, or by a name spelt another way in the same village. */
describe("the duplicate check", () => {
  it("sets spelling variants and word order aside", () => {
    expect(nameKey("Mohammad Karimi")).toBe(nameKey("Muhammad Kareemi"));
    expect(nameKey("Mohamed Karimi")).toBe(nameKey("Karimi Mohammad"));
    expect(nameKey("Ahmad al-Rahimi")).toBe(nameKey("Ahmed Rahimi"));
    expect(nameKey("Qasim Noori")).toBe(nameKey("Kasim Nouri"));
    expect(nameKey("Fatima Noori")).not.toBe(nameKey("Farida Noori"));
  });

  it("one phone number written many ways", () => {
    expect(phoneKey("+93 70 123 4567")).toBe(phoneKey("0701234567"));
    expect(phoneKey("12")).toBe("");
  });

  it("finds a farmer already registered and one twice on the list, by ID only", () => {
    const registered = [{ id: "F-1", village: "Qala", name: "Mohammad Karimi", phone: "0701234567" }, { id: "F-2", village: "Deh", name: "Ahmad Rahimi" }];
    const incoming = [
      { id: "F-10", village: "Qala", name: "Muhammad Kareemi" },
      { id: "F-11", village: "Bagh", name: "Ahmed Rahimi" }, // another village: not flagged on the name
      { id: "F-12", village: "Bagh", name: "Zainab", phone: "+93 70 123 4567" },
      { id: "F-13", village: "Bagh", name: "Ahmad Rahimi" }, // like F-11, on the same list
      { id: "F-1", village: "Qala", name: "Mohammad Karimi" }, // the same ID: an update, not a duplicate
    ];
    const d = possibleDuplicates(incoming, registered);
    expect(d).toEqual([
      { id: "F-10", other: "F-1", why: "name" },
      { id: "F-12", other: "F-1", why: "phone" },
      { id: "F-13", other: "F-11", why: "name" },
    ]);
    const text = duplicatesText(d);
    expect(text).toContain("F-12 has the same phone number as F-1");
    expect(text).not.toMatch(/Karimi|Rahimi|Zainab/);
  });

  it("a farmer list may carry phones, kept with a name only", () => {
    expect(parseFarmers("id,village,sex,hectares,name,phone\nF-1,Qala,F,0.5,Zainab,0701234567").rows[0].phone).toBe("0701234567");
    expect(parseFarmers("id,village,sex,hectares,phone\nF-1,Qala,F,0.5,0701234567").problems[0]).toContain("kept with the farmer's name");
  });
});
