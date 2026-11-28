import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { aiFault, DRAFT_MODEL, plainAiError } from "@/server/ai";
import { aiFailure } from "@/server/limits";

/** 27 Nov: "the AI key was not accepted" covered two faults. A wrong key and a key that may not use the model now read differently. */
const headers = new Headers();
const fake = "sk-ant-api03-" + "x".repeat(60);
const wrongKey = new Anthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, "401 invalid x-api-key", headers);
const noModel = new Anthropic.PermissionDeniedError(403, { type: "error", error: { type: "permission_error", message: `Your key ${fake} may not use this model` } }, "403", headers);

describe("a wrong key and a key that may not use the model", () => {
  it("get two different sentences", () => {
    expect(plainAiError(wrongKey, false)).toMatch(/replace ANTHROPIC_API_KEY/);
    const m = plainAiError(noModel, false);
    expect(m).toContain(DRAFT_MODEL);
    expect(m).toMatch(/whoever manages the Anthropic account/);
    expect(m).not.toMatch(/replace/);
  });
  it("keep the service's own status and message, never the key", () => {
    expect(aiFault(wrongKey)).toEqual({ status: 401, apiMessage: "authentication_error: invalid x-api-key" });
    const f = aiFault(noModel)!;
    expect(f.status).toBe(403);
    expect(f.apiMessage).toContain("permission_error");
    expect(f.apiMessage).not.toContain("sk-ant");
    expect(f.apiMessage).not.toContain("xxxxxxxx");
    expect(aiFault(new Error("boom"))).toBeNull();
  });
  it("show on Settings, Health with what the service said", () => {
    const line = aiFailure({ what: "Draft the request for quotation", error: plainAiError(noModel, false), ...aiFault(noModel) });
    expect(line.why).toBe("AI: Draft the request for quotation");
    expect(line.cause).toMatch(/^Status 403\. permission_error/);
    expect(aiFailure({ job: "x", error: "Too many" }).cause).toBeNull();
  });
});
