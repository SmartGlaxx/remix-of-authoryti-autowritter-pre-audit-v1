// Serializable contracts for AI-selected page compositions. The AI chooses a spec;
// a deterministic renderer owns geometry, text flow, print safety and final pixels.

export const PAGE_DESIGN_BOOK_TYPES = ["children", "magazine", "manual"] as const;
export type PageDesignBookType = typeof PAGE_DESIGN_BOOK_TYPES[number];

export type StyleFamily =
  | "classic"
  | "playful"
  | "modern-minimal"
  | "storybook"
  | "whimsical"
  | "editorial"
  | "career-guide";

export type CompositionMode = "consistent" | "guided-random" | "dynamic-ai" | "fully-randomized" | "manual";

// Fifty structural starting points. Shape, treatment, typography, color and text flow
// remain independent so these are building blocks, not fifty rigid templates.
export const LAYOUT_STRUCTURES = [
  // Top image (10)
  "top-centered", "top-left", "top-right", "top-wide", "top-third",
  "top-half", "top-bleed", "top-large-text-below", "top-large-text-beside", "top-offset-overlap",
  // Bottom image (8)
  "bottom-centered", "bottom-left", "bottom-right", "bottom-third",
  "bottom-half", "bottom-bleed", "bottom-text-above", "bottom-text-beside",
  // Side / split (12)
  "split-left", "split-right", "split-left-narrow", "split-right-narrow",
  "split-left-wide", "split-right-wide", "split-left-overlap", "split-right-overlap",
  "split-left-bleed", "split-right-bleed", "split-left-stacked", "split-right-stacked",
  // Centered / island (6)
  "center-island", "center-wrap", "center-divider", "center-above", "center-below", "center-offset",
  // Full page / bleed (6)
  "full-bleed-overlay", "full-bleed-negative-space", "full-page-caption",
  "full-page-text-panel", "full-bleed-wrap", "full-bleed-spread",
  // Multiple images (8)
  "multi-image-2-row", "multi-image-2-column", "multi-image-2-diagonal", "multi-image-2-opposing-corners",
  "multi-image-3-row", "multi-image-3-cluster", "multi-image-4-grid", "multi-image-scattered-cluster",
] as const;
export type LayoutStructure = typeof LAYOUT_STRUCTURES[number];

export type ImageShape =
  | "rectangle"
  | "square"
  | "circle"
  | "oval"
  | "rounded"
  | "vertical-portrait"
  | "horizontal-landscape"
  | "organic-blob-1"
  | "organic-blob-2"
  | "arch";

export type ImageTreatment =
  | "framed"
  | "borderless"
  | "feathered"
  | "soft-fade-bottom"
  | "soft-fade-edge"
  | "decorative-border"
  | "overlap"
  | "background-blend"
  | "bleed";

export type TextFlowMode =
  | "wrap-left"
  | "wrap-right"
  | "wrap-around-circle"
  | "wrap-around-organic"
  | "wrap-top-bottom"
  | "over-negative-space"
  | "multi-column"
  | "block";

export type TextPosition =
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "center"
  | "upper-left"
  | "upper-center"
  | "upper-right"
  | "lower-left"
  | "lower-center"
  | "lower-right"
  | "between-images"
  | "around-images"
  | "negative-space";

export interface PageImageSpec {
  url: string;
  alt: string;
  shape: ImageShape;
  treatment: ImageTreatment;
  size: "small" | "medium" | "large" | "full";
  alignment: "left" | "right" | "center" | "bleed";
  /** Optional renderer-safe focal point, expressed as percentages from 0–100. */
  focalPoint?: { x: number; y: number };
}

export interface PageTextBlockSpec {
  content: string;
  flow: TextFlowMode;
  position?: TextPosition;
  dropCap?: boolean;
  heading?: string;
  align: "left" | "center" | "justify";
  columns?: 1 | 2 | 3;
}

export interface PageTypographySpec {
  /** A registered font token from the app's typography catalog. */
  fontFamily: string;
  fontSize: "sm" | "base" | "lg" | "xl";
  fontWeight?: 400 | 500 | 600 | 700;
  letterSpacing?: string;
  lineHeight: string;
  paragraphSpacing?: string;
}

export interface PageColorSpec {
  /** Semantic design-token names, never hard-coded hex colors in components. */
  bg: string;
  text: string;
  accent: string;
  frame?: string;
  heading?: string;
  highlight?: string;
}

export interface PageDecorationSpec {
  kind: "stars" | "leaves" | "clouds" | "dots" | "shapes" | "line" | "border" | "ornament" | "pattern" | "texture";
  position: string;
  /** Semantic accent token; decorations must remain subordinate to reading. */
  colorToken?: string;
}

export interface PrintGeometry {
  pageSize: "square" | "letter" | "custom";
  widthInches: number;
  heightInches: number;
  bleedInches: number;
  safeMarginInches: number;
  gutterInches: number;
  minimumImageDpi?: number;
}

export interface PageCompositionSpec {
  schemaVersion?: 1;
  pageIndex: number;
  isSpread?: boolean;
  styleFamily: StyleFamily;
  compositionMode?: CompositionMode;
  layout: LayoutStructure;
  images: PageImageSpec[];
  textBlock: PageTextBlockSpec;
  typography: PageTypographySpec;
  colors: PageColorSpec;
  decorations?: PageDecorationSpec[];
  print?: PrintGeometry;
}

/** Input boundary for a future composition service; it returns PageCompositionSpec only. */
export interface PageCompositionInput {
  bookType: PageDesignBookType;
  pageIndex: number;
  text: string;
  images: Pick<PageImageSpec, "url" | "alt" | "focalPoint">[];
  styleFamily: StyleFamily;
  mode: CompositionMode;
  emotionalTone?: string;
  pacing?: "quiet" | "balanced" | "dynamic";
  print: PrintGeometry;
}
