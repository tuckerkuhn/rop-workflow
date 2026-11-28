import { describe, expect, it } from "vitest";
import { replyMeans } from "@/lib/outbox";
import { formCacheKey, OFFLINE_PHONE_TEST_PASSED } from "@/lib/app-forms";

/** Part 2 step 5: forms saved without signal wait on the phone until the server confirms them. */
describe("the phone's outbox", () => {
  it("a server that is down or busy is tried again; only a real refusal is shown as refused", () => {
    expect(replyMeans(200)).toBe("sent");
    for (const s of [500, 502, 503, 504, 408, 429]) expect(replyMeans(s)).toBe("retry");
    for (const s of [400, 403, 409, 413, 422]) expect(replyMeans(s)).toBe("refused");
  });

  it("each form is kept per person, project and form; the forms say to use signal until the phone test passes", () => {
    expect(formCacheKey("farida", "A-2027", "distribution")).toBe("rop-form:farida:A-2027:distribution");
    expect(OFFLINE_PHONE_TEST_PASSED).toBe(false);
  });
});
