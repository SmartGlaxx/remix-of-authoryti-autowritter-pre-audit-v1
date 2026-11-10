import { describe, expect, it } from "vitest";
import { dramaticActionDirective } from "../../supabase/functions/_shared/writers/dramaticAction";

describe("dramatic action directive", () => {
  it("bans procedural narration in narrative prose types", () => {
    for (const type of ["novel", "fiction-serial", "short-story", "biography", "memoir"]) {
      const rule = dramaticActionDirective(type);
      expect(rule).toContain("NEVER narrate the process of finding things out");
      expect(rule).toContain("One fact of consequence lands in one sentence");
      expect(rule).toContain("Two sentences maximum per revelation");
      expect(rule).toContain("feelings are the payload");
      expect(dramaticActionDirective(type)).toBe(rule);
    }
  });

  it("stays out of formats with their own engines", () => {
    for (const type of ["children", "comic", "drama", "poetry", "cookbook", "finance", "self-help", "programming"]) {
      expect(dramaticActionDirective(type)).toBe("");
    }
  });
});
