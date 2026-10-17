import { describe, expect, it } from "vitest";
import { applyTargetedEdits, bestParagraph, discussionPrompt, locate, parseDiscussion, recommend } from "../../supabase/functions/_shared/narrative/planning/conflictReview";

describe("paired conflict evidence and targeted repairs", () => {
  it("locates the full paragraph containing the quoted line", () => {
    expect(bestParagraph("First paragraph.\n\nKiera counts nine beats. She rests her hand on the door.", "Kiera counts nine beats.")).toEqual({ paragraph: "Kiera counts nine beats. She rests her hand on the door.", index: 1 });
  });
  it("does not invent a page for missing evidence", () => {
    expect(locate({ chapters: [{ subsections: [{ content: "hello" }] }] }, 0, 0, null).page).toBeNull();
  });
  it("does not present a rhythm paragraph as proof of a personal counting habit", () => {
    expect(bestParagraph('Kiera magnified the waveform. The pulse held rhythm — nine beats, pause, nine beats.', 'Kiera Vance counts a nine-beat rhythm to keep her hands still')).toBeNull();
  });
  it("does not dismiss conflicting age claims just because most words overlap", () => {
    expect(recommend({ severity: "MAJOR", priorSource: "accepted_text", priorText: "Aron was an adult man at the station", newText: "Aron was a child at the station" }).choice).toBe("prior");
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

describe("editorial discussion chat", () => {
  const base = { truth: "Kiera counts nine beats", conflicting: "She counted nine beats, paused, then nine more.", description: "Counting pattern differs", recommendation: "Keep the established detail." };
  it("includes the evidence, recommendation and recent conversation in the prompt", () => {
    const p = discussionPrompt({ ...base, history: [{ role: "author", content: "She pauses only when stressed." }] });
    expect(p.user).toContain("Kiera counts nine beats");
    expect(p.user).toContain("Keep the established detail.");
    expect(p.user).toContain("Author: She pauses only when stressed.");
    expect(p.system).toContain("JSON");
  });
  it("caps the replayed conversation at 12 turns", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" as const : "author" as const, content: `turn ${i}` }));
    const p = discussionPrompt({ ...base, history });
    expect(p.user).not.toContain("turn 0");
    expect(p.user).toContain("turn 19");
  });
  it("parses a reply with suggested edits", () => {
    const r = parseDiscussion('{"reply":"Merge both: the pause marks stress.","edits":[{"find":"nine more","replace":"nine more — a stress pause"}]}');
    expect(r.reply).toContain("Merge both");
    expect(r.edits).toHaveLength(1);
  });
  it("degrades safely on malformed output instead of crashing", () => {
    const r = parseDiscussion("not json at all");
    expect(r.reply).toContain("rephrasing");
    expect(r.edits).toEqual([]);
  });
});