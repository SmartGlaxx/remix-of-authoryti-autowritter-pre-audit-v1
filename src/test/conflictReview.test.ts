import { describe, expect, it } from "vitest";
import { applyTargetedEdits, bestParagraph, locate, recommend } from "../../supabase/functions/_shared/narrative/planning/conflictReview";

describe("paired conflict evidence and targeted repairs", () => {
  it("locates the full paragraph containing the quoted line", () => {
    expect(bestParagraph("First paragraph.\n\nKiera counts nine beats. She rests her hand on the door.", "Kiera counts nine beats.")).toEqual({ paragraph: "Kiera counts nine beats. She rests her hand on the door.", index: 1 });
  });
  it("does not invent a page for missing evidence", () => {
    expect(locate({ chapters: [{ subsections: [{ content: "hello" }] }] }, 0, 0, null).page).toBeNull();
  });
  it("estimates pages by word count and records paragraph position", () => {
    const outline = { chapters: [{ title: "One", subsections: [{ content: "word ".repeat(250) }, { title: "Two", content: "The man entered." }] }] };
    expect(locate(outline, 0, 1, 0)).toMatchObject({ page: 2, paragraphNumber: 1, sectionTitle: "Two" });
  });
  it("preserves author-set facts over generated wording", () => {
    expect(recommend({ severity: "MAJOR", priorSource: "author", priorText: "Kiera counts nine beats", newText: "Kiera counts nine beats slowly" }).choice).toBe("prior");
  });
  it("does not equate adult man with child", () => {
    expect(recommend({ severity: "CRITICAL", priorSource: "accepted_text", priorText: "Aron is an adult man", newText: "Aron is a child" }).choice).toBe("prior");
  });
  it("changes only the unambiguous conflicting passage", () => {
    const original = "Aron stepped forward. He was a child. The old bell rang and the crowd fell silent.";
    expect(applyTargetedEdits(original, [{ find: "He was a child.", replace: "He was a man." }])).toEqual({ text: original.replace("He was a child.", "He was a man."), applied: 1 });
  });
  it("rejects ambiguous matching and whole-section rewrites", () => {
    const repeated = "He was a child. He was a child. The bell rang.";
    expect(applyTargetedEdits(repeated, [{ find: "He was a child.", replace: "He was a man." }]).applied).toBe(0);
    expect(applyTargetedEdits(repeated, [{ find: repeated, replace: "New story" }]).applied).toBe(0);
  });
});