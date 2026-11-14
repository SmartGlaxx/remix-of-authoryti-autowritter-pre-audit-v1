import { DECORATION_KINDS, DECORATION_POSITIONS, IMAGE_SHAPES, IMAGE_TREATMENTS, LAYOUT_STRUCTURES, PAGE_DESIGN_BOOK_TYPES, PAGE_DESIGN_SCHEMA_VERSION, STYLE_FAMILIES, TEXT_FLOW_MODES, TEXT_POSITIONS, COMPOSITION_MODES, type BookDesignSettings, type CompositionChoice, type PageCompositionSpec, type PrintGeometry } from "./types.ts";
import { FONT_TOKENS, MIN_BODY_PT, compatibleAccent, getLayout, shapeAllowed, treatmentAllowed } from "./catalog.ts";

export interface ValidationResult<T> { ok: boolean; errors: string[]; value?: T }
const inList = (list: readonly string[], v: unknown): boolean => typeof v === "string" && list.includes(v);
const num = (v: unknown, a: number, b: number) => typeof v === "number" && Number.isFinite(v) && v >= a && v <= b;
const HSL = /^\d{1,3}(\.\d+)? \d{1,3}(\.\d+)?% \d{1,3}(\.\d+)?%$/;

export function isSafeImageUrl(u: unknown): boolean {
  if (u === "") return true; // empty slot (awaiting an illustration)
  if (typeof u !== "string" || u.length > 2048) return false;
  try { const url = new URL(u); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}

export function validatePrint(p: unknown, errors: string[]): p is PrintGeometry {
  const g = p as PrintGeometry;
  if (!g || typeof g !== "object") { errors.push("print missing"); return false; }
  if (!inList(["square", "letter", "custom"], g.pageSize)) errors.push("print.pageSize invalid");
  if (!num(g.trimWidthIn, 4, 17) || !num(g.trimHeightIn, 4, 17)) errors.push("trim size must be 4–17 in");
  if (!num(g.bleedIn, 0, 0.5)) errors.push("bleed must be 0–0.5 in");
  if (!num(g.safeMarginIn, 0.125, 1.5)) errors.push("safe margin must be 0.125–1.5 in");
  if (!num(g.gutterIn, 0, 1.5)) errors.push("gutter must be 0–1.5 in");
  if (!num(g.minDpi, 72, 1200)) errors.push("minDpi must be 72–1200");
  return true;
}

const box = (b: unknown) => { const o = b as Record<string, unknown>; return !!o && num(o.x, -2, 40) && num(o.y, -2, 40) && num(o.w, 0.05, 40) && num(o.h, 0.05, 40); };

export function validateSpec(raw: unknown): ValidationResult<PageCompositionSpec> {
  const e: string[] = []; const s = raw as PageCompositionSpec;
  if (!s || typeof s !== "object") return { ok: false, errors: ["spec must be an object"] };
  if (s.schemaVersion !== PAGE_DESIGN_SCHEMA_VERSION) e.push(`schemaVersion must be ${PAGE_DESIGN_SCHEMA_VERSION}`);
  if (typeof s.pageKey !== "string" || !s.pageKey || s.pageKey.length > 120) e.push("pageKey invalid");
  if (!inList(PAGE_DESIGN_BOOK_TYPES, s.bookType)) e.push("bookType unsupported");
  if (!inList(STYLE_FAMILIES, s.styleFamily)) e.push("styleFamily unsupported");
  if (s.accentFamily !== undefined && (!inList(STYLE_FAMILIES, s.accentFamily) || !compatibleAccent(s.styleFamily, s.accentFamily))) e.push("accentFamily incompatible");
  if (!inList(LAYOUT_STRUCTURES, s.layout)) e.push("layout unsupported");
  const def = getLayout(s.layout);
  if (def && !!def.spread !== !!s.isSpread) e.push("isSpread must match layout");
  if (!Number.isInteger(s.seed)) e.push("seed must be an integer");
  const pv = s.provenance;
  if (!pv || !inList(["ai", "deterministic", "deterministic-fallback", "randomized", "manual"], pv.source) || !inList(COMPOSITION_MODES, pv.mode)) e.push("provenance invalid");
  else if (pv.source === "deterministic-fallback" && !pv.fallbackReason) e.push("fallback provenance must disclose the reason");
  else if (pv.source === "ai" && !pv.model) e.push("AI provenance must name the model");
  if (!Array.isArray(s.images) || s.images.length > 6) e.push("images must be an array (≤6)");
  else {
    if (def && s.images.length !== def.slots.length) e.push(`layout ${s.layout} needs ${def.slots.length} image slot(s)`);
    s.images.forEach((im, i) => {
      if (!isSafeImageUrl(im?.url)) e.push(`images[${i}].url must be https`);
      if (!inList(IMAGE_SHAPES, im?.shape)) e.push(`images[${i}].shape unsupported`);
      if (!inList(IMAGE_TREATMENTS, im?.treatment)) e.push(`images[${i}].treatment unsupported`);
      if (!box(im?.box)) e.push(`images[${i}].box invalid`);
      if (!im?.focal || !num(im.focal.x, 0, 1) || !num(im.focal.y, 0, 1) || !num(im.focal.w, 0, 1) || !num(im.focal.h, 0, 1)) e.push(`images[${i}].focal invalid`);
      if (typeof im?.alt !== "string" || im.alt.length > 500) e.push(`images[${i}].alt invalid`);
      if (inList(STYLE_FAMILIES, s.styleFamily) && inList(IMAGE_SHAPES, im?.shape) && im.bleed?.length === 0 && !shapeAllowed(s.styleFamily, im.shape, s.accentFamily) && s.provenance?.source !== "manual") e.push(`images[${i}].shape not compatible with ${s.styleFamily}`);
      if (inList(STYLE_FAMILIES, s.styleFamily) && inList(IMAGE_TREATMENTS, im?.treatment) && im.treatment !== "bleed" && !treatmentAllowed(s.styleFamily, im.treatment, s.accentFamily) && s.provenance?.source !== "manual") e.push(`images[${i}].treatment not compatible with ${s.styleFamily}`);
    });
  }
  if (!Array.isArray(s.textRegions) || !s.textRegions.length || s.textRegions.length > 6) e.push("textRegions must have 1–6 entries");
  else {
    const orders = s.textRegions.map((r) => r.order);
    if (new Set(orders).size !== orders.length) e.push("textRegions order must be unique");
    s.textRegions.forEach((r, i) => {
      if (!box(r.box)) e.push(`textRegions[${i}].box invalid`);
      if (!inList(TEXT_FLOW_MODES, r.flow)) e.push(`textRegions[${i}].flow unsupported`);
      if (!inList(TEXT_POSITIONS, r.position)) e.push(`textRegions[${i}].position unsupported`);
      if (!inList(["left", "center", "justify"], r.align)) e.push(`textRegions[${i}].align unsupported`);
      if (![1, 2, 3].includes(r.columns)) e.push(`textRegions[${i}].columns must be 1–3`);
    });
  }
  const t = s.typography;
  if (!t || !(t.headingFont in FONT_TOKENS) || !(t.bodyFont in FONT_TOKENS)) e.push("typography fonts must be registered tokens");
  else {
    if (inList(PAGE_DESIGN_BOOK_TYPES, s.bookType) && !num(t.bodyPt, MIN_BODY_PT[s.bookType], 48)) e.push(`body size must be ≥ ${MIN_BODY_PT[s.bookType]}pt for ${s.bookType}`);
    if (!num(t.headingPt, t.bodyPt, 120)) e.push("heading size must be ≥ body size");
    if (!num(t.lineHeight, 1.1, 2.2)) e.push("lineHeight must be 1.1–2.2");
    if (!num(t.paragraphSpacingPt, 0, 48) || !num(t.letterSpacingEm, -0.05, 0.2)) e.push("spacing out of range");
  }
  const c = s.colors;
  if (!c || ![c.paper, c.ink, c.accent, c.panel].every((v) => typeof v === "string" && HSL.test(v))) e.push("colors must be HSL triplets");
  if (!Array.isArray(s.decorations) || s.decorations.length > 4 || s.decorations.some((d) => !inList(DECORATION_KINDS, d?.kind) || !inList(DECORATION_POSITIONS, d?.position) || ![1, 2, 3].includes(d?.density))) e.push("decorations invalid");
  validatePrint(s.print, e);
  if (typeof s.textHash !== "string") e.push("textHash missing");
  return { ok: e.length === 0, errors: e, value: e.length ? undefined : s };
}

export function validateSettings(raw: unknown): ValidationResult<BookDesignSettings> {
  const e: string[] = []; const s = raw as BookDesignSettings;
  if (!s || s.schemaVersion !== PAGE_DESIGN_SCHEMA_VERSION) e.push("settings schemaVersion invalid");
  if (!inList(STYLE_FAMILIES, s?.styleFamily)) e.push("styleFamily unsupported");
  if (s?.accentFamily !== undefined && !compatibleAccent(s.styleFamily, s.accentFamily)) e.push("accentFamily incompatible");
  if (!inList(COMPOSITION_MODES, s?.mode)) e.push("mode unsupported");
  if (!Number.isInteger(s?.seed)) e.push("seed must be an integer");
  if (!num(s?.bodyPt, 8, 48)) e.push("bodyPt out of range");
  validatePrint(s?.print, e);
  return { ok: !e.length, errors: e, value: e.length ? undefined : s };
}

/** Validates an AI-proposed choice against the allowed candidates and style compatibility. */
export function validateChoice(raw: unknown, ctx: { candidates: string[]; styleFamily: CompositionChoice["accentFamily"] & string; accentFamily?: string }): ValidationResult<CompositionChoice> {
  const e: string[] = []; const c = raw as CompositionChoice;
  if (!c || typeof c !== "object") return { ok: false, errors: ["choice must be an object"] };
  if (!ctx.candidates.includes(c.layout)) e.push(`layout ${String(c.layout)} not among candidates`);
  const def = getLayout(c.layout);
  const fam = ctx.styleFamily as never;
  if (c.accentFamily !== undefined && (!inList(STYLE_FAMILIES, c.accentFamily) || !compatibleAccent(fam, c.accentFamily))) e.push("accentFamily incompatible");
  if (!Array.isArray(c.shapes) || (def && c.shapes.length !== def.slots.length) || c.shapes.some((sh) => !inList(IMAGE_SHAPES, sh) || !shapeAllowed(fam, sh, c.accentFamily))) e.push("shapes invalid for layout/style");
  if (!Array.isArray(c.treatments) || (def && c.treatments.length !== def.slots.length) || c.treatments.some((t) => !inList(IMAGE_TREATMENTS, t) || (t !== "bleed" && !treatmentAllowed(fam, t, c.accentFamily)))) e.push("treatments invalid for layout/style");
  if (c.flow !== undefined && !inList(TEXT_FLOW_MODES, c.flow)) e.push("flow unsupported");
  if (c.position !== undefined && !inList(TEXT_POSITIONS, c.position)) e.push("position unsupported");
  if (typeof c.dropCap !== "boolean") e.push("dropCap must be boolean");
  if (!Array.isArray(c.decorations) || c.decorations.length > 3 || c.decorations.some((d) => !inList(DECORATION_KINDS, d?.kind) || !inList(DECORATION_POSITIONS, d?.position) || ![1, 2, 3].includes(d?.density))) e.push("decorations invalid");
  if (c.rationale !== undefined && (typeof c.rationale !== "string" || c.rationale.length > 400)) e.push("rationale too long");
  return { ok: !e.length, errors: e, value: e.length ? undefined : c };
}
