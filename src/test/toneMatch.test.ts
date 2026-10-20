import { describe, it, expect } from "vitest";
import { tonePreset, matchWriterToTone, recommendWriterForTone, ideationVoiceBlock } from "../../supabase/functions/_shared/writers/toneMatch";
import { WRITER_BASELINES } from "../../supabase/functions/_shared/writers/manifest";
import { buildAlternativesPrompt, buildConceptsPrompt } from "../../supabase/functions/_shared/narrative/planning/aiPlanning";

const brief = { title: "T", bookType: "novel", premise: "A lighthouse keeper finds a letter.", targetWords: 50000, chapterCount: 12 };

describe("Tone ↔ writer harmony", () => {
  it("tone never pushes a slider beyond the writer's baseline ±2", () => {
    const p = tonePreset("claire", "Funny");
    expect(p.humor).toBe(3); // Claire baseline 1
    for (const [k, v] of Object.entries(p)) expect(Math.abs(v - WRITER_BASELINES.claire![k as keyof typeof p])).toBeLessThanOrEqual(2);
  });
  it("Claire on Funny is a stretch; Nora on Funny is natural", () => {
    expect(matchWriterToTone("claire", "Funny")!.fit).toBe("stretch");
    expect(matchWriterToTone("nora", "Funny")!.fit).toBe("natural");
  });
  it("tone changes the suggested writer; no tone = book-type best fit", () => {
    expect(recommendWriterForTone(null, "children").id).toBe("nora");
    expect(recommendWriterForTone("Funny", "novel").id).not.toBe(recommendWriterForTone("Literary", "novel").id);
  });
  it("Book Variants prompts carry the selected writer's voice", () => {
    const voice = ideationVoiceBlock("ethan", "Funny");
    expect(buildAlternativesPrompt({ ...brief, voice }, 3).user).toContain("Ethan Cole");
    expect(buildConceptsPrompt({ ...brief, bookType: "self-help", voice: ideationVoiceBlock("elena", null) }, 3).user).toContain("Elena Marlowe");
    expect(buildAlternativesPrompt(brief, 3).user).not.toContain("WRITER VOICE");
  });
});
