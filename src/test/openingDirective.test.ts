import { describe, expect, it } from "vitest";
import { openingDirective } from "../../supabase/functions/_shared/writers/opening";
import { ENABLED_BOOK_TYPES } from "../types/book";

describe("opening guidance", () => {
  it("covers every enabled book type without formulaic starts", () => {
    for (const type of ENABLED_BOOK_TYPES) {
      const guidance = openingDirective(type);
      expect(guidance).toContain("There's a particular kind of");
      expect(guidance).toContain("Vary the shape of openings");
      expect(guidance).toContain("resume at that precise point");
      expect(openingDirective(type)).toBe(guidance);
    }
  });

  it("uses appropriate nonfiction and format-aware alternatives", () => {
    expect(openingDirective("finance")).toContain("never invent figures");
    expect(openingDirective("self-help")).toContain("Advance the argument");
    expect(openingDirective("novel")).not.toContain("do not force danger");
    expect(openingDirective("novel")).toContain("selected writer's voice");
    expect(openingDirective("drama")).toContain("scene-heading");
    expect(openingDirective("comic")).toContain("panel format");
    expect(openingDirective("cookbook")).toContain("measurements");
    expect(openingDirective("programming")).toContain("technical accuracy");
  });
});