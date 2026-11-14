import { describe, expect, it } from "vitest";
import { LAYOUT_STRUCTURES, PAGE_DESIGN_BOOK_TYPES, type PageCompositionSpec } from "@/types/pageDesign";

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
    const spec: PageCompositionSpec = {
      pageIndex: 0,
      styleFamily: "career-guide",
      layout: "split-right",
      images: [{ url: "signed-image-url", alt: "A mentor speaking with a new employee", shape: "circle", treatment: "feathered", size: "large", alignment: "right" }],
      textBlock: { content: "Your first week", flow: "wrap-left", align: "left", dropCap: true },
      typography: { fontFamily: "body-sans", fontSize: "base", lineHeight: "relaxed" },
      colors: { bg: "background", text: "foreground", accent: "primary" },
      print: { pageSize: "letter", widthInches: 8.5, heightInches: 11, bleedInches: 0.125, safeMarginInches: 0.25, gutterInches: 0.375 },
    };
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
    expect(spec.textBlock.flow).toBe("wrap-left");
  });
});
