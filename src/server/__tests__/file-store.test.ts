import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

/**
 * Review round 1, Part 2 step 4: proof photos out of the database into file storage, with the
 * fingerprint kept in the record and checked again when the photo is read. The storage service is
 * a stand-in here: nothing outside is called.
 */
const bytes = Buffer.from("fictional photo bytes");
const SRC = `data:image/jpeg;base64,${bytes.toString("base64")}`;
const HASH = createHash("sha256").update(bytes).digest("hex");

describe("where proof photos are kept", () => {
  const env = { ...process.env };
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  it("by default the photo stays inside the record, with its fingerprint: nothing changes", async () => {
    delete process.env.PROOF_FILE_STORE;
    const { keepPhoto, storeMode } = await import("@/server/file-store");
    expect(storeMode()).toBe("inline");
    expect(await keepPhoto("A-2027", SRC)).toEqual({ src: SRC, sha256: HASH });
  });

  it("with file storage on, the record keeps only a reference; reading it back checks the fingerprint", async () => {
    Object.assign(process.env, { PROOF_FILE_STORE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid", SUPABASE_SERVICE_ROLE_KEY: "test-only" });
    const stored = new Map<string, Buffer>();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/storage/v1/bucket")) return new Response("{}", { status: 200 });
      const path = url.split("/object/")[1];
      if (init?.method === "POST") {
        stored.set(path, Buffer.from(init.body as Uint8Array));
        return new Response("{}", { status: 200 });
      }
      const b = stored.get(path);
      return b ? new Response(new Uint8Array(b), { status: 200, headers: { "content-type": "image/jpeg" } }) : new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { keepPhoto, fetchPhoto } = await import("@/server/file-store");
    const kept = await keepPhoto("A-2027", SRC);
    expect(kept).toEqual({ src: `file:${HASH}`, sha256: HASH });
    expect(fetchMock.mock.calls[1][0]).toBe(`https://example.invalid/storage/v1/object/proof-files/A-2027/${HASH}`);
    expect((await fetchPhoto("A-2027", HASH))!.intact).toBe(true);
    // A file changed in storage after it was saved no longer matches its fingerprint.
    stored.set(`proof-files/A-2027/${HASH}`, Buffer.from("something else"));
    expect((await fetchPhoto("A-2027", HASH))!.intact).toBe(false);
    expect(await fetchPhoto("A-2027", "0".repeat(64))).toBeNull();
  });

  it("the record's fingerprint is read the same from a picture or a reference", async () => {
    const { photoFingerprint } = await import("@/server/field-store");
    expect(photoFingerprint(SRC)).toBe(HASH);
    expect(photoFingerprint(`file:${HASH}`)).toBe(HASH);
  });
});
