import { describe, expect, it } from "vitest";
import { reusablePersonaProfile } from "../../supabase/functions/_shared/narrative/personaReuse";
describe("deleted-book persona reuse", () => {
  const source = { id: "old", display_name: "Mara", aliases: ["M"], universe_id: "old-world", seed_details: { deleted_book_title: "Old book", secrets: ["culprit"] } };
  it("preserves personal details and portrait", () => {
    const copy = reusablePersonaProfile(source, { psychology: { motivation: "Protect family" }, voice_sample: "Stay close.", portrait_path: "owner/image.jpg" });
    expect(copy.displayName).toBe("Mara");
    expect(copy.profile.psychology).toEqual({ motivation: "Protect family" });
    expect(copy.profile.voice_sample).toBe("Stay close.");
    expect(copy.profile.portrait_path).toBe("owner/image.jpg");
  });
  it("does not revive deleted-book history or inherited universe", () => {
    const copy = reusablePersonaProfile(source, { milestones: [{ event: "Old murder" }], ai_expansions: ["Old secret"] });
    expect(copy.seedDetails).toEqual({ reused_from_identity_id: "old" });
    expect(copy.profile.milestones).toEqual([]);
    expect(copy.profile.ai_expansions).toEqual([]);
    expect(copy).not.toHaveProperty("universe_id");
  });
});