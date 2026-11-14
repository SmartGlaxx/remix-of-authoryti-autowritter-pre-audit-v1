// Serializable page-composition contracts (schema v2). The AI (or a seeded deterministic
// chooser) picks a spec; the deterministic geometry engine owns text flow and print safety.
// Coordinates are inches from the trim top-left. Spread specs use a 2×trim-width canvas.

export const PAGE_DESIGN_SCHEMA_VERSION = 2 as const;
export const PAGE_DESIGN_BOOK_TYPES = ["children", "magazine", "manual"] as const;
export type PageDesignBookType = typeof PAGE_DESIGN_BOOK_TYPES[number];

export const STYLE_FAMILIES = ["classic", "playful", "modern-minimal", "storybook", "whimsical", "editorial", "career-guide"] as const;
export type StyleFamily = typeof STYLE_FAMILIES[number];

export const COMPOSITION_MODES = ["consistent", "guided-random", "dynamic-ai", "fully-randomized", "manual"] as const;
export type CompositionMode = typeof COMPOSITION_MODES[number];

export const LAYOUT_STRUCTURES = [
  "top-centered", "top-left", "top-right", "top-wide", "top-third",
  "top-half", "top-bleed", "top-large-text-below", "top-large-text-beside", "top-offset-overlap",
  "bottom-centered", "bottom-left", "bottom-right", "bottom-third",
  "bottom-half", "bottom-bleed", "bottom-text-above", "bottom-text-beside",
  "split-left", "split-right", "split-left-narrow", "split-right-narrow",
  "split-left-wide", "split-right-wide", "split-left-overlap", "split-right-overlap",
  "split-left-bleed", "split-right-bleed", "split-left-stacked", "split-right-stacked",
  "center-island", "center-wrap", "center-divider", "center-above", "center-below", "center-offset",
  "full-bleed-overlay", "full-bleed-negative-space", "full-page-caption",
  "full-page-text-panel", "full-bleed-wrap", "full-bleed-spread",
  "multi-image-2-row", "multi-image-2-column", "multi-image-2-diagonal", "multi-image-2-opposing-corners",
  "multi-image-3-row", "multi-image-3-cluster", "multi-image-4-grid", "multi-image-scattered-cluster",
] as const;
export type LayoutStructure = typeof LAYOUT_STRUCTURES[number];
/** Internal text-only layout used for automatic continuation / parity pages. Not one of the 50. */
export type InternalLayout = "continuation" | "parity-filler";

export const IMAGE_SHAPES = ["rectangle", "square", "circle", "oval", "rounded", "vertical-portrait", "horizontal-landscape", "organic-blob-1", "organic-blob-2", "arch"] as const;
export type ImageShape = typeof IMAGE_SHAPES[number];

export const IMAGE_TREATMENTS = ["framed", "borderless", "feathered", "soft-fade-bottom", "soft-fade-edge", "decorative-border", "overlap", "background-blend", "bleed"] as const;
export type ImageTreatment = typeof IMAGE_TREATMENTS[number];

export const TEXT_FLOW_MODES = ["wrap-left", "wrap-right", "wrap-around-circle", "wrap-around-organic", "wrap-top-bottom", "over-negative-space", "multi-column", "block"] as const;
export type TextFlowMode = typeof TEXT_FLOW_MODES[number];

export const TEXT_POSITIONS = ["top", "bottom", "left", "right", "center", "upper-left", "upper-center", "upper-right", "lower-left", "lower-center", "lower-right", "between-images", "around-images", "negative-space"] as const;
export type TextPosition = typeof TEXT_POSITIONS[number];

export const DECORATION_KINDS = ["stars", "leaves", "clouds", "dots", "shapes", "line", "border", "ornament", "pattern", "texture"] as const;
export type DecorationKind = typeof DECORATION_KINDS[number];
export const DECORATION_POSITIONS = ["top", "bottom", "corners", "border", "background"] as const;
export type DecorationPosition = typeof DECORATION_POSITIONS[number];

export interface Box { x: number; y: number; w: number; h: number }
export type BleedSide = "top" | "bottom" | "left" | "right";

export interface PageImageSpec {
  slot: number;
  url: string;              // https or project storage URL only (validated)
  alt: string;
  shape: ImageShape;
  treatment: ImageTreatment;
  box: Box;                 // inches, trim coordinates (may extend into bleed)
  bleed: BleedSide[];
  /** Important-subject zone, normalized 0–1 in the source image. Kept out of gutter/trim. */
  focal: { x: number; y: number; w: number; h: number };
  naturalWidth?: number;
  naturalHeight?: number;
  z: number;
}

export interface PageTextRegionSpec {
  order: number;            // reading order; text fills regions in this order
  box: Box;                 // inches; clipped to the live (safe) area at layout time
  flow: TextFlowMode;
  position: TextPosition;
  align: "left" | "center" | "justify";
  columns: 1 | 2 | 3;
  overImage: boolean;       // sits on artwork (needs a panel or verified contrast)
  panel: boolean;           // solid/translucent backing panel
}

export interface PageTypographySpec {
  headingFont: string;      // registered token from FONT_TOKENS
  bodyFont: string;
  bodyPt: number;
  headingPt: number;
  lineHeight: number;       // multiple of bodyPt
  paragraphSpacingPt: number;
  letterSpacingEm: number;
  dropCap: boolean;
}

/** Print palette as HSL triplets "H S% L%"; validated, never raw CSS. */
export interface PageColorSpec { paper: string; ink: string; accent: string; panel: string }

export interface PageDecorationSpec { kind: DecorationKind; position: DecorationPosition; density: 1 | 2 | 3 }

export interface PrintGeometry {
  pageSize: "square" | "letter" | "custom";
  trimWidthIn: number;
  trimHeightIn: number;
  bleedIn: number;
  safeMarginIn: number;
  gutterIn: number;
  minDpi: number;
}

export type ProvenanceSource = "ai" | "deterministic" | "deterministic-fallback" | "randomized" | "manual";
export interface CompositionProvenance {
  source: ProvenanceSource;
  mode: CompositionMode;
  model?: string;
  /** Required when source is deterministic-fallback: why AI was not used. */
  fallbackReason?: string;
  rationale?: string;
  createdAt: string;
}

export interface PageCompositionSpec {
  schemaVersion: typeof PAGE_DESIGN_SCHEMA_VERSION;
  pageKey: string;          // stable content unit (section id) — not the physical page number
  bookType: PageDesignBookType;
  styleFamily: StyleFamily;
  accentFamily?: StyleFamily;
  layout: LayoutStructure;
  isSpread: boolean;
  seed: number;
  provenance: CompositionProvenance;
  images: PageImageSpec[];
  textRegions: PageTextRegionSpec[];
  typography: PageTypographySpec;
  colors: PageColorSpec;
  decorations: PageDecorationSpec[];
  print: PrintGeometry;
  /** Hash of the manuscript text this design was made for; mismatch is flagged, never silently used. */
  textHash: string;
}

export interface BookDesignSettings {
  schemaVersion: typeof PAGE_DESIGN_SCHEMA_VERSION;
  styleFamily: StyleFamily;
  accentFamily?: StyleFamily;
  mode: CompositionMode;
  seed: number;
  print: PrintGeometry;
  bodyPt: number;
}

/** Page features sent to the composition service (AI or deterministic). */
export interface PageFeatures {
  words: number;
  paragraphs: number;
  dialogueRatio: number;
  avgSentenceWords: number;
  emotion: "calm" | "tender" | "tense" | "joyful" | "sad" | "wonder" | "neutral";
  intensity: number;        // 0–1
  pacing: "quiet" | "balanced" | "dynamic";
  imageCount: number;
  focal: { x: number; y: number; w: number; h: number }[];
}

export interface PageCompositionInput {
  bookType: PageDesignBookType;
  pageKey: string;
  pageIndex: number;
  heading?: string;
  text: string;
  images: { url: string; alt: string; focal?: PageImageSpec["focal"]; naturalWidth?: number; naturalHeight?: number }[];
  settings: BookDesignSettings;
  /** Layouts of the preceding pages (book-level visual rhythm). */
  recentLayouts: LayoutStructure[];
}

/** What the AI is allowed to choose; the deterministic builder turns it into a full spec. */
export interface CompositionChoice {
  layout: LayoutStructure;
  shapes: ImageShape[];
  treatments: ImageTreatment[];
  flow?: TextFlowMode;
  position?: TextPosition;
  dropCap: boolean;
  decorations: PageDecorationSpec[];
  accentFamily?: StyleFamily;
  rationale?: string;
}
