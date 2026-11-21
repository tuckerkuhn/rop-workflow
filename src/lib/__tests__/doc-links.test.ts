import { describe, expect, it } from "vitest";
import { docLinksSchema, docSource, docTitle, isDocUrl } from "@/lib/doc-links";
import { storyInputSchema } from "@/lib/stories";

describe("document links on stories", () => {
  it("accepts https links from anywhere, and nothing else", () => {
    expect(isDocUrl("https://example.sharepoint.com/sites/Programs/Shared%20Documents/story.docx")).toBe(true);
    expect(isDocUrl("https://drive.google.com/file/d/abc/view")).toBe(true);
    expect(isDocUrl("http://drive.google.com/file/d/abc")).toBe(false);
    expect(isDocUrl("javascript:alert(1)")).toBe(false);
    expect(isDocUrl("https://not a link")).toBe(false);
    expect(isDocUrl("https://localhost")).toBe(false);
  });

  it("names where each link opens", () => {
    expect(docSource("https://example.sharepoint.com/x")).toBe("SharePoint");
    expect(docSource("https://example-my.sharepoint.com/x")).toBe("OneDrive");
    expect(docSource("https://drive.google.com/x")).toBe("Google Drive");
    expect(docSource("https://docs.google.com/document/d/x")).toBe("Google Docs");
    expect(docSource("https://www.example.org/a")).toBe("example.org");
    expect(docTitle({ url: "https://drive.google.com/x", title: " " })).toBe("Document in Google Drive");
  });

  it("is kept with a story, and a bad link is refused", () => {
    const base = { title: "From one field to two", notes: "", text: "", photos: [], consent: null, links: [] };
    expect(storyInputSchema.parse({ ...base, docs: [{ url: "https://drive.google.com/x", title: "Interview" }] }).docs).toHaveLength(1);
    expect(storyInputSchema.safeParse({ ...base, docs: [{ url: "ftp://x.org/a", title: "" }] }).success).toBe(false);
    expect(docLinksSchema.safeParse(Array.from({ length: 11 }, (_, k) => ({ url: `https://x.org/${k}`, title: "" }))).success).toBe(false);
  });
});
