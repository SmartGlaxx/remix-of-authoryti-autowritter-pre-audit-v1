import { describe, expect, it } from "vitest";
import { ideaToInput, type BookIdea } from "@/components/BookIdeasGenerator";
import { WRITER_BASELINES } from "../../supabase/functions/_shared/writers/manifest";

describe("Saved idea setup mapping", () => {
  const writerId = Object.keys(WRITER_BASELINES)[0];
  const idea: BookIdea = { title: "My saved title", subtitle: "Legacy subtitle", description: "My saved premise", bookType: "novel", genre: "Mystery", audience: "general-readers", writerId, whyThisWriter: "", divergence: "controlled", sliders: null };
  it("keeps the saved title, premise, category and audience without consuming the idea", () => {
    const before = JSON.stringify(idea);
    expect(ideaToInput(idea)).toMatchObject({ title: "My saved title", theme: "My saved premise", bookType: "novel", genre: "Mystery", audience: "general-readers" });
    expect(JSON.stringify(idea)).toBe(before);
  });
  it("restores the saved writer and voice baseline", () => {
    const input = ideaToInput(idea);
    expect(input.controls?.writerId).toBe(writerId);
    expect(input.controls?.velocity).toBe(WRITER_BASELINES[writerId].pacing);
    expect(input.toneProfile?.formality).toBe(WRITER_BASELINES[writerId].formality);
    expect(input.controls?.divergenceMode).toBe("controlled");
  });
  it("does not reintroduce legacy subtitles into book creation", () => {
    expect(ideaToInput(idea).subtitle).toBeUndefined();
  });
});