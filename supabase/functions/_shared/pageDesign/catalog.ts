import type { BleedSide, Box, DecorationKind, ImageShape, ImageTreatment, LayoutStructure, PageDesignBookType, PrintGeometry, StyleFamily, TextFlowMode, TextPosition } from "./types.ts";
import { LAYOUT_STRUCTURES } from "./types.ts";

export type LayoutCategory = "top" | "bottom" | "side" | "center" | "full" | "multi";

/** All coordinates are fractions of the trim (spread layouts: of one page; x may reach 2). */
export interface SlotDef extends Box { bleed: BleedSide[]; z?: number; role: "hero" | "support" }
export interface RegionDef extends Box { flow: TextFlowMode; position: TextPosition; overImage?: boolean; panel?: boolean; columns?: 1 | 2 }
export interface LayoutDef {
  id: LayoutStructure;
  category: LayoutCategory;
  slots: SlotDef[];
  regions: RegionDef[];
  spread?: boolean;
  defaultShape: ImageShape;
  /** Text regions sit next to (not around) artwork; geometry engine still computes the lines. */
  description: string;
}

const s = (x: number, y: number, w: number, h: number, bleed: BleedSide[] = [], role: SlotDef["role"] = "hero", z = 1): SlotDef => ({ x, y, w, h, bleed, role, z });
const r = (x: number, y: number, w: number, h: number, flow: TextFlowMode = "block", position: TextPosition = "top", extra: Partial<RegionDef> = {}): RegionDef => ({ x, y, w, h, flow, position, ...extra });
const FULL = (flow: TextFlowMode, position: TextPosition = "around-images") => r(0, 0, 1, 1, flow, position);
const ALL: BleedSide[] = ["top", "bottom", "left", "right"];

const L = (id: LayoutStructure, category: LayoutCategory, slots: SlotDef[], regions: RegionDef[], defaultShape: ImageShape, description: string, spread = false): LayoutDef => ({ id, category, slots, regions, defaultShape, description, spread });

export const LAYOUT_CATALOG: readonly LayoutDef[] = [
  // ── Top (10)
  L("top-centered", "top", [s(0.2, 0.06, 0.6, 0.38)], [r(0, 0.48, 1, 0.52, "block", "bottom")], "rounded", "Centered picture above a full-width text block"),
  L("top-left", "top", [s(0.06, 0.06, 0.46, 0.36)], [FULL("wrap-right", "right")], "rectangle", "Picture in the upper-left; text wraps its right edge then runs full width"),
  L("top-right", "top", [s(0.48, 0.06, 0.46, 0.36)], [FULL("wrap-left", "left")], "rectangle", "Picture in the upper-right; text wraps its left edge"),
  L("top-wide", "top", [s(0.06, 0.06, 0.88, 0.3)], [r(0, 0.4, 1, 0.6, "block", "bottom")], "horizontal-landscape", "Wide panorama band at the top"),
  L("top-third", "top", [s(0, 0, 1, 0.33, ["top", "left", "right"])], [r(0, 0.36, 1, 0.64, "block", "bottom")], "rectangle", "Top third bleeds off three edges"),
  L("top-half", "top", [s(0, 0, 1, 0.5, ["top", "left", "right"])], [r(0, 0.53, 1, 0.47, "block", "bottom")], "rectangle", "Top half bleeds; text in the lower half"),
  L("top-bleed", "top", [s(0, 0, 1, 0.64, ["top", "left", "right"])], [r(0, 0.67, 1, 0.33, "block", "bottom")], "rectangle", "Two-thirds bleed with a short text foot"),
  L("top-large-text-below", "top", [s(0.14, 0.05, 0.72, 0.52)], [r(0, 0.6, 1, 0.4, "block", "lower-center")], "arch", "Large framed hero with display text below"),
  L("top-large-text-beside", "top", [s(0.06, 0.06, 0.58, 0.48)], [r(0.67, 0.06, 0.27, 0.48, "block", "upper-right"), r(0, 0.58, 1, 0.42, "block", "bottom")], "vertical-portrait", "Hero with a narrow side column, then full-width text"),
  L("top-offset-overlap", "top", [s(0.1, 0.03, 0.72, 0.44, [], "hero", 2)], [r(0, 0.36, 1, 0.64, "wrap-top-bottom", "bottom")], "organic-blob-1", "Offset hero whose lower edge cuts into the text block"),
  // ── Bottom (8)
  L("bottom-centered", "bottom", [s(0.2, 0.56, 0.6, 0.38)], [r(0, 0, 1, 0.53, "block", "top")], "rounded", "Text first, centered picture below"),
  L("bottom-left", "bottom", [s(0.06, 0.56, 0.46, 0.38)], [FULL("wrap-right", "right")], "rectangle", "Picture lower-left; text wraps its right edge"),
  L("bottom-right", "bottom", [s(0.48, 0.56, 0.46, 0.38)], [FULL("wrap-left", "left")], "rectangle", "Picture lower-right; text wraps its left edge"),
  L("bottom-third", "bottom", [s(0, 0.67, 1, 0.33, ["bottom", "left", "right"])], [r(0, 0, 1, 0.64, "block", "top")], "rectangle", "Bottom third bleeds off three edges"),
  L("bottom-half", "bottom", [s(0, 0.5, 1, 0.5, ["bottom", "left", "right"])], [r(0, 0, 1, 0.47, "block", "top")], "rectangle", "Bottom half bleeds"),
  L("bottom-bleed", "bottom", [s(0, 0.36, 1, 0.64, ["bottom", "left", "right"])], [r(0, 0, 1, 0.33, "block", "top")], "rectangle", "Two-thirds bleed under a short text head"),
  L("bottom-text-above", "bottom", [s(0.08, 0.42, 0.84, 0.52)], [r(0, 0, 1, 0.4, "block", "upper-center")], "oval", "Big oval vignette under a text head"),
  L("bottom-text-beside", "bottom", [s(0.06, 0.46, 0.58, 0.48)], [r(0, 0, 1, 0.43, "block", "top"), r(0.67, 0.46, 0.27, 0.48, "block", "lower-right")], "vertical-portrait", "Text head, then picture with a side column"),
  // ── Side / split (12)
  L("split-left", "side", [s(0, 0, 0.5, 1, ["top", "left", "bottom"])], [r(0.52, 0, 0.48, 1, "block", "right")], "rectangle", "Half-page picture on the left"),
  L("split-right", "side", [s(0.5, 0, 0.5, 1, ["top", "right", "bottom"])], [r(0, 0, 0.48, 1, "block", "left")], "rectangle", "Half-page picture on the right"),
  L("split-left-narrow", "side", [s(0, 0, 0.32, 1, ["top", "left", "bottom"])], [r(0.34, 0, 0.66, 1, "block", "right")], "vertical-portrait", "Narrow left strip"),
  L("split-right-narrow", "side", [s(0.68, 0, 0.32, 1, ["top", "right", "bottom"])], [r(0, 0, 0.66, 1, "block", "left")], "vertical-portrait", "Narrow right strip"),
  L("split-left-wide", "side", [s(0, 0, 0.62, 1, ["top", "left", "bottom"])], [r(0.64, 0, 0.36, 1, "block", "right")], "rectangle", "Wide left picture, slim text column"),
  L("split-right-wide", "side", [s(0.38, 0, 0.62, 1, ["top", "right", "bottom"])], [r(0, 0, 0.36, 1, "block", "left")], "rectangle", "Wide right picture, slim text column"),
  L("split-left-overlap", "side", [s(0, 0.12, 0.58, 0.72, ["left"])], [FULL("wrap-right", "right")], "organic-blob-2", "Left picture breaks into text, which wraps above, beside and below"),
  L("split-right-overlap", "side", [s(0.42, 0.12, 0.58, 0.72, ["right"])], [FULL("wrap-left", "left")], "organic-blob-2", "Right picture breaks into text"),
  L("split-left-bleed", "side", [s(0, 0, 0.42, 0.68, ["top", "left"])], [FULL("wrap-right", "right")], "rectangle", "Corner bleed upper-left; L-shaped text"),
  L("split-right-bleed", "side", [s(0.58, 0, 0.42, 0.68, ["top", "right"])], [FULL("wrap-left", "left")], "rectangle", "Corner bleed upper-right; L-shaped text"),
  L("split-left-stacked", "side", [s(0.06, 0.06, 0.4, 0.42), s(0.06, 0.52, 0.4, 0.3, [], "support")], [r(0.5, 0, 0.5, 1, "block", "right")], "rounded", "Two unequal stacked pictures on the left"),
  L("split-right-stacked", "side", [s(0.54, 0.06, 0.4, 0.3, [], "support"), s(0.54, 0.4, 0.4, 0.54)], [r(0, 0, 0.5, 1, "block", "left")], "rounded", "Two unequal stacked pictures on the right"),
  // ── Center / island (6) — need true geometric regions (text on both sides)
  L("center-island", "center", [s(0.3, 0.33, 0.4, 0.34)], [FULL("wrap-around-circle", "around-images")], "circle", "Circular island; text flows on both sides"),
  L("center-wrap", "center", [s(0.22, 0.24, 0.56, 0.3)], [FULL("wrap-around-organic", "around-images")], "organic-blob-1", "Organic island, wider than tall"),
  L("center-divider", "center", [s(0.06, 0.41, 0.88, 0.18)], [r(0, 0, 1, 0.38, "block", "top"), r(0, 0.62, 1, 0.38, "block", "bottom")], "horizontal-landscape", "Picture band divides two text blocks"),
  L("center-above", "center", [s(0.26, 0.2, 0.48, 0.4)], [r(0, 0, 1, 0.17, "block", "upper-center"), r(0, 0.63, 1, 0.37, "block", "bottom")], "arch", "Short lead line, centered arch, then text"),
  L("center-below", "center", [s(0.32, 0.5, 0.36, 0.3)], [r(0, 0, 1, 0.47, "block", "top"), r(0, 0.83, 1, 0.17, "block", "lower-center")], "oval", "Text, small centered vignette, closing line"),
  L("center-offset", "center", [s(0.44, 0.34, 0.4, 0.32)], [FULL("wrap-around-circle", "around-images")], "circle", "Off-center island; wide left lane, narrow right lane"),
  // ── Full page / bleed (6)
  L("full-bleed-overlay", "full", [s(0, 0, 1, 1, ALL)], [r(0.04, 0.62, 0.92, 0.34, "over-negative-space", "lower-center", { overImage: true, panel: true })], "rectangle", "Full-bleed art with a lower text panel"),
  L("full-bleed-negative-space", "full", [s(0, 0, 1, 1, ALL)], [r(0.04, 0.04, 0.52, 0.4, "over-negative-space", "negative-space", { overImage: true })], "rectangle", "Text set in the art's empty sky/space (contrast-checked)"),
  L("full-page-caption", "full", [s(0, 0, 1, 0.85, ["top", "left", "right"])], [r(0, 0.88, 1, 0.12, "block", "bottom")], "rectangle", "Near-full art with a caption strip"),
  L("full-page-text-panel", "full", [s(0, 0, 1, 1, ALL)], [r(0.12, 0.24, 0.76, 0.52, "over-negative-space", "center", { overImage: true, panel: true })], "rectangle", "Full art, centered reading panel"),
  L("full-bleed-wrap", "full", [s(0, 0, 0.64, 0.74, ["top", "left"])], [FULL("wrap-around-organic", "lower-right")], "organic-blob-2", "Huge organic bleed shape with text wrapping its curve"),
  L("full-bleed-spread", "full", [s(0, 0, 2, 1, ALL)], [r(1.06, 0.06, 0.4, 0.42, "over-negative-space", "upper-right", { overImage: true, panel: true })], "rectangle", "Two-page spread; text kept on the right page clear of the gutter", true),
  // ── Multi-image (8)
  L("multi-image-2-row", "multi", [s(0.06, 0.06, 0.54, 0.34), s(0.64, 0.1, 0.3, 0.24, [], "support")], [r(0, 0.44, 1, 0.56, "block", "bottom")], "rounded", "Two unequal pictures side by side"),
  L("multi-image-2-column", "multi", [s(0.06, 0.06, 0.38, 0.54), s(0.06, 0.64, 0.38, 0.3, [], "support")], [r(0.48, 0, 0.52, 1, "block", "right")], "rectangle", "Two unequal pictures in a column"),
  L("multi-image-2-diagonal", "multi", [s(0.06, 0.06, 0.44, 0.32), s(0.5, 0.6, 0.44, 0.34, [], "support")], [FULL("wrap-around-organic", "between-images")], "circle", "Diagonal pair; text weaves between"),
  L("multi-image-2-opposing-corners", "multi", [s(0, 0, 0.38, 0.3, ["top", "left"]), s(0.62, 0.7, 0.38, 0.3, ["bottom", "right"], "support")], [FULL("wrap-around-organic", "between-images")], "organic-blob-1", "Bleeding corner pictures"),
  L("multi-image-3-row", "multi", [s(0.06, 0.06, 0.42, 0.3), s(0.52, 0.06, 0.24, 0.3, [], "support"), s(0.8, 0.06, 0.14, 0.3, [], "support")], [r(0, 0.4, 1, 0.6, "block", "bottom")], "rounded", "Three diminishing pictures"),
  L("multi-image-3-cluster", "multi", [s(0.06, 0.06, 0.5, 0.42), s(0.6, 0.06, 0.34, 0.2, [], "support"), s(0.6, 0.28, 0.34, 0.2, [], "support")], [r(0, 0.52, 1, 0.48, "block", "bottom")], "rectangle", "One hero with two companions"),
  L("multi-image-4-grid", "multi", [s(0.06, 0.06, 0.42, 0.26), s(0.52, 0.06, 0.42, 0.26), s(0.06, 0.36, 0.3, 0.2, [], "support"), s(0.4, 0.36, 0.54, 0.2, [], "support")], [r(0, 0.6, 1, 0.4, "block", "bottom")], "rectangle", "Four-picture asymmetric grid"),
  L("multi-image-scattered-cluster", "multi", [s(0.06, 0.08, 0.28, 0.22), s(0.62, 0.04, 0.32, 0.26, [], "support"), s(0.12, 0.62, 0.3, 0.24, [], "support"), s(0.58, 0.66, 0.34, 0.26, [], "support")], [FULL("wrap-around-organic", "around-images")], "circle", "Scattered vignettes with text weaving around"),
];

export const LAYOUT_BY_ID: Record<string, LayoutDef> = Object.fromEntries(LAYOUT_CATALOG.map((l) => [l.id, l]));
export const getLayout = (id: string): LayoutDef | undefined => LAYOUT_BY_ID[id];
export const isLayoutId = (id: unknown): id is LayoutStructure => typeof id === "string" && (LAYOUT_STRUCTURES as readonly string[]).includes(id);

// ── Typography
export const FONT_TOKENS: Record<string, { css: string; kind: "serif" | "sans" | "rounded" }> = {
  "libre-baskerville": { css: "'Libre Baskerville', Georgia, serif", kind: "serif" },
  lora: { css: "'Lora', Georgia, serif", kind: "serif" },
  "baloo-2": { css: "'Baloo 2', 'Nunito', sans-serif", kind: "rounded" },
  nunito: { css: "'Nunito', sans-serif", kind: "rounded" },
  "dm-sans": { css: "'DM Sans', sans-serif", kind: "sans" },
  fraunces: { css: "'Fraunces', Georgia, serif", kind: "serif" },
  fredoka: { css: "'Fredoka', 'Nunito', sans-serif", kind: "rounded" },
  "playfair-display": { css: "'Playfair Display', Georgia, serif", kind: "serif" },
  "source-serif-4": { css: "'Source Serif 4', Georgia, serif", kind: "serif" },
  "space-grotesk": { css: "'Space Grotesk', sans-serif", kind: "sans" },
};

export interface StyleFamilyDef {
  id: StyleFamily; label: string; headingFont: string; bodyFont: string;
  palettes: { paper: string; ink: string; accent: string; panel: string }[];
  shapes: ImageShape[]; treatments: ImageTreatment[]; decorations: DecorationKind[];
  compatible: StyleFamily[]; dropCap: boolean; lineHeight: number;
}

export const STYLE_FAMILY_DEFS: Record<StyleFamily, StyleFamilyDef> = {
  classic: { id: "classic", label: "Classic", headingFont: "libre-baskerville", bodyFont: "lora", palettes: [{ paper: "40 33% 96%", ink: "30 15% 15%", accent: "15 55% 38%", panel: "40 33% 96%" }], shapes: ["rectangle", "rounded", "oval", "arch", "vertical-portrait", "horizontal-landscape", "square"], treatments: ["framed", "decorative-border", "borderless", "soft-fade-edge", "bleed"], decorations: ["ornament", "line", "border"], compatible: ["storybook", "editorial"], dropCap: true, lineHeight: 1.45 },
  playful: { id: "playful", label: "Playful", headingFont: "baloo-2", bodyFont: "nunito", palettes: [{ paper: "48 100% 96%", ink: "220 30% 18%", accent: "350 80% 55%", panel: "0 0% 100%" }], shapes: ["circle", "organic-blob-1", "organic-blob-2", "rounded", "square", "oval", "rectangle"], treatments: ["borderless", "framed", "overlap", "feathered", "bleed"], decorations: ["stars", "dots", "shapes", "clouds"], compatible: ["whimsical", "storybook"], dropCap: false, lineHeight: 1.4 },
  "modern-minimal": { id: "modern-minimal", label: "Modern minimal", headingFont: "dm-sans", bodyFont: "dm-sans", palettes: [{ paper: "0 0% 99%", ink: "220 15% 12%", accent: "200 70% 40%", panel: "0 0% 100%" }], shapes: ["rectangle", "square", "circle", "horizontal-landscape", "vertical-portrait"], treatments: ["borderless", "bleed", "overlap"], decorations: ["line"], compatible: ["editorial", "career-guide"], dropCap: false, lineHeight: 1.5 },
  storybook: { id: "storybook", label: "Storybook", headingFont: "fraunces", bodyFont: "lora", palettes: [{ paper: "38 45% 94%", ink: "25 30% 16%", accent: "150 35% 32%", panel: "38 45% 97%" }], shapes: ["arch", "oval", "rounded", "organic-blob-1", "circle", "rectangle"], treatments: ["feathered", "soft-fade-bottom", "soft-fade-edge", "decorative-border", "framed", "bleed", "background-blend"], decorations: ["leaves", "clouds", "ornament", "stars", "border"], compatible: ["classic", "whimsical", "playful"], dropCap: true, lineHeight: 1.45 },
  whimsical: { id: "whimsical", label: "Whimsical", headingFont: "fredoka", bodyFont: "nunito", palettes: [{ paper: "270 60% 97%", ink: "260 30% 20%", accent: "180 60% 38%", panel: "0 0% 100%" }], shapes: ["organic-blob-1", "organic-blob-2", "circle", "oval", "arch", "rounded"], treatments: ["feathered", "soft-fade-edge", "overlap", "borderless", "background-blend", "bleed"], decorations: ["stars", "clouds", "dots", "shapes", "pattern"], compatible: ["playful", "storybook"], dropCap: false, lineHeight: 1.4 },
  editorial: { id: "editorial", label: "Editorial", headingFont: "playfair-display", bodyFont: "source-serif-4", palettes: [{ paper: "0 0% 98%", ink: "0 0% 10%", accent: "0 70% 42%", panel: "0 0% 100%" }], shapes: ["rectangle", "vertical-portrait", "horizontal-landscape", "square", "circle"], treatments: ["borderless", "bleed", "framed", "overlap"], decorations: ["line", "border"], compatible: ["modern-minimal", "classic", "career-guide"], dropCap: true, lineHeight: 1.4 },
  "career-guide": { id: "career-guide", label: "Career guide", headingFont: "space-grotesk", bodyFont: "dm-sans", palettes: [{ paper: "210 30% 98%", ink: "215 30% 14%", accent: "35 90% 48%", panel: "0 0% 100%" }], shapes: ["rectangle", "rounded", "circle", "square", "horizontal-landscape"], treatments: ["borderless", "framed", "bleed", "overlap"], decorations: ["line", "dots", "shapes"], compatible: ["modern-minimal", "editorial"], dropCap: false, lineHeight: 1.5 },
};

export const BOOK_TYPE_STYLES: Record<PageDesignBookType, StyleFamily[]> = {
  children: ["storybook", "playful", "whimsical", "classic"],
  magazine: ["editorial", "modern-minimal", "classic"],
  manual: ["career-guide", "modern-minimal", "editorial"],
};

/** Age-appropriate readability floors (pt). The engine never sets type below these. */
export const MIN_BODY_PT: Record<PageDesignBookType, number> = { children: 16, magazine: 9, manual: 9.5 };
export const DEFAULT_BODY_PT: Record<PageDesignBookType, number> = { children: 20, magazine: 10.5, manual: 11 };
/** Controlled variation: per-page size may differ from the book base by at most this many pt. */
export const MAX_PAGE_PT_VARIATION = 2;

export const DEFAULT_PRINT: Record<PageDesignBookType, PrintGeometry> = {
  children: { pageSize: "square", trimWidthIn: 8.5, trimHeightIn: 8.5, bleedIn: 0.125, safeMarginIn: 0.375, gutterIn: 0.375, minDpi: 300 },
  magazine: { pageSize: "letter", trimWidthIn: 8.5, trimHeightIn: 11, bleedIn: 0.125, safeMarginIn: 0.5, gutterIn: 0.5, minDpi: 300 },
  manual: { pageSize: "letter", trimWidthIn: 8.5, trimHeightIn: 11, bleedIn: 0.125, safeMarginIn: 0.5, gutterIn: 0.5, minDpi: 300 },
};

export const asDesignBookType = (t: string): PageDesignBookType | null => t === "children" || t === "magazine" || t === "manual" ? t : t === "comic" || t === "picture-book" ? "children" : null;

/** Style family compatibility: a page may mix its primary family with one listed accent family. */
export const compatibleAccent = (primary: StyleFamily, accent?: StyleFamily) => !accent || accent === primary || STYLE_FAMILY_DEFS[primary].compatible.includes(accent);

export function compatibleLayouts(bookType: PageDesignBookType, imageCount: number, opts: { allowSpread?: boolean } = {}): LayoutDef[] {
  return LAYOUT_CATALOG.filter((l) => {
    if (l.spread && !opts.allowSpread) return false;
    if (imageCount === 0) return false; // text-only units use the internal continuation layout
    if (l.slots.length > imageCount) return false;
    if (l.slots.length < Math.min(imageCount, 1)) return false;
    // Children's pages avoid tiny dense multi grids; manuals avoid huge organic bleeds.
    if (bookType === "children" && l.id === "multi-image-4-grid") return false;
    if (bookType === "manual" && (l.id === "full-bleed-wrap" || l.id === "full-bleed-negative-space")) return false;
    return true;
  });
}

export const shapeAllowed = (family: StyleFamily, shape: ImageShape, accent?: StyleFamily) => STYLE_FAMILY_DEFS[family].shapes.includes(shape) || (!!accent && compatibleAccent(family, accent) && STYLE_FAMILY_DEFS[accent].shapes.includes(shape));
export const treatmentAllowed = (family: StyleFamily, t: ImageTreatment, accent?: StyleFamily) => STYLE_FAMILY_DEFS[family].treatments.includes(t) || (!!accent && compatibleAccent(family, accent) && STYLE_FAMILY_DEFS[accent].treatments.includes(t));
