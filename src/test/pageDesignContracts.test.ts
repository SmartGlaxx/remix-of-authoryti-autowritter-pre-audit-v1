import { composeDeterministic, defaultSettings } from "../../supabase/functions/_shared/pageDesign/compose";
import { validateSpec } from "../../supabase/functions/_shared/pageDesign/validate";
import { describe, expect, it } from "vitest";
import { LAYOUT_STRUCTURES, PAGE_DESIGN_BOOK_TYPES } from "@/types/pageDesign";

describe("visual page-composition contracts", () => {
  it("supports children's books, magazines and manuals", () => {
    expect(PAGE_DESIGN_BOOK_TYPES).toEqual(["children", "magazine", "manual"]);
  });

  it("defines 50 unique structural building blocks", () => {
    expect(LAYOUT_STRUCTURES).toHaveLength(50);
    expect(new Set(LAYOUT_STRUCTURES).size).toBe(50);
  });

  it("covers top, bottom, side, center, full-page and multi-image structures", () => {
    for (const prefix of ["top-", "bottom-", "split-", "center-", "full-", "multi-image-"]) {
      expect(LAYOUT_STRUCTURES.some((layout) => layout.startsWith(prefix))).toBe(true);
    }
  });

  it("keeps AI composition serializable and separate from rendering", () => {
    const spec = composeDeterministic({ bookType: "manual", pageKey: "section-1", pageIndex: 0, text: "Your first week", images: [], settings: defaultSettings("manual", "book-1"), recentLayouts: [] }, "consistent");
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
    expect(validateSpec(spec).errors).toEqual([]);
    expect(spec.schemaVersion).toBe(2);
  });
});
