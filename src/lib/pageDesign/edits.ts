import { buildSpec } from "../../../supabase/functions/_shared/pageDesign/compose";
import { MIN_BODY_PT, MAX_PAGE_PT_VARIATION, getLayout, FONT_TOKENS } from "./layoutCatalog";
import type { Box, DecorationKind, DecorationPosition, ImageShape, ImageTreatment, LayoutStructure, PageCompositionInput, PageCompositionSpec, TextFlowMode, TextPosition } from "@/types/pageDesign";
import { isSafeImageUrl } from "../../../supabase/functions/_shared/pageDesign/validate";

export type PageEdit =
  | { type: "layout"; layout: LayoutStructure }
  | { type: "moveImage"; slot: number; dx: number; dy: number }
  | { type: "resizeImage"; slot: number; scale: number }
  | { type: "setImageBox"; slot: number; box: Box }
  | { type: "shape"; slot: number; shape: ImageShape }
  | { type: "treatment"; slot: number; treatment: ImageTreatment }
  | { type: "replaceImage"; slot: number; url: string; alt?: string; naturalWidth?: number; naturalHeight?: number }
  | { type: "focal"; slot: number; x: number; y: number }
  | { type: "textPosition"; region: number; position: TextPosition }
  | { type: "textFlow"; region: number; flow: TextFlowMode }
  | { type: "textAlign"; region: number; align: "left" | "center" | "justify" }
  | { type: "columns"; region: number; columns: 1 | 2 | 3 }
  | { type: "panel"; region: number; panel: boolean }
  | { type: "font"; which: "heading" | "body"; font: string }
  | { type: "fontSize"; bodyPt: number; bookBasePt: number }
  | { type: "color"; key: "paper" | "ink" | "accent" | "panel"; hsl: string }
  | { type: "dropCap"; on: boolean }
  | { type: "decorations"; kinds: { kind: DecorationKind; position: DecorationPosition }[] };

export interface EditResult { spec: PageCompositionSpec; note?: string }

const markManual = (s: PageCompositionSpec): PageCompositionSpec => ({ ...s, provenance: { ...s.provenance, source: "manual", mode: "manual", fallbackReason: undefined, model: s.provenance.model, createdAt: new Date().toISOString(), rationale: `Edited by the author (originally ${s.provenance.source})` } });
const withImage = (s: PageCompositionSpec, slot: number, f: (im: PageCompositionSpec["images"][number]) => PageCompositionSpec["images"][number]) => ({ ...s, images: s.images.map((im) => im.slot === slot ? f(im) : im) });
const withRegion = (s: PageCompositionSpec, i: number, f: (r: PageCompositionSpec["textRegions"][number]) => PageCompositionSpec["textRegions"][number]) => ({ ...s, textRegions: s.textRegions.map((r, j) => j === i ? f(r) : r) });

/** Pure, localized edits: only the named page's spec changes (repagination may follow). */
export function applyEdit(spec: PageCompositionSpec, edit: PageEdit, input?: PageCompositionInput): EditResult {
  const W = spec.print.trimWidthIn * (spec.isSpread ? 2 : 1), H = spec.print.trimHeightIn, b = spec.print.bleedIn;
  const clampBox = (bx: Box): Box => { const w = Math.min(Math.max(bx.w, 0.5), W + 2 * b), h = Math.min(Math.max(bx.h, 0.5), H + 2 * b); return { w, h, x: Math.min(Math.max(bx.x, -b), W + b - w), y: Math.min(Math.max(bx.y, -b), H + b - h) }; };
  switch (edit.type) {
    case "layout": {
      if (!input) return { spec, note: "Layout change needs the page content" };
      const def = getLayout(edit.layout); if (!def) return { spec, note: "Unknown layout" };
      const pool = [...spec.images.filter((i) => i.url).map((i) => ({ url: i.url, alt: i.alt, focal: i.focal, naturalWidth: i.naturalWidth, naturalHeight: i.naturalHeight })), ...input.images.filter((a) => !spec.images.some((i) => i.url === a.url))];
      const next = buildSpec({ ...input, images: pool }, { layout: edit.layout, shapes: def.slots.map((_, i) => spec.images[i]?.shape ?? def.defaultShape), treatments: def.slots.map((sl, i) => sl.bleed.length ? "bleed" : (spec.images[i]?.treatment === "bleed" ? "borderless" : spec.images[i]?.treatment ?? "borderless")), dropCap: spec.typography.dropCap, decorations: spec.decorations }, spec.provenance);
      return { spec: markManual({ ...next, typography: spec.typography, colors: spec.colors, accentFamily: spec.accentFamily }), note: def.slots.length > pool.length ? `This layout has ${def.slots.length} picture slots; empty slots are flagged until filled` : undefined };
    }
    case "moveImage": return { spec: markManual(withImage(spec, edit.slot, (im) => ({ ...im, box: clampBox({ ...im.box, x: im.box.x + edit.dx, y: im.box.y + edit.dy }) }))) };
    case "resizeImage": return { spec: markManual(withImage(spec, edit.slot, (im) => { const w = im.box.w * edit.scale, h = im.box.h * edit.scale; return { ...im, box: clampBox({ x: im.box.x - (w - im.box.w) / 2, y: im.box.y - (h - im.box.h) / 2, w, h }) }; })) };
    case "setImageBox": return { spec: markManual(withImage(spec, edit.slot, (im) => ({ ...im, box: clampBox(edit.box) }))) };
    case "shape": return { spec: markManual(withImage(spec, edit.slot, (im) => ({ ...im, shape: edit.shape }))) };
    case "treatment": return { spec: markManual(withImage(spec, edit.slot, (im) => ({ ...im, treatment: edit.treatment }))) };
    case "replaceImage":
      if (!isSafeImageUrl(edit.url)) return { spec, note: "Only https picture links can be used" };
      return { spec: markManual(withImage(spec, edit.slot, (im) => ({ ...im, url: edit.url, alt: edit.alt ?? im.alt, naturalWidth: edit.naturalWidth, naturalHeight: edit.naturalHeight }))) };
    case "focal": return { spec: markManual(withImage(spec, edit.slot, (im) => ({ ...im, focal: { w: im.focal.w, h: im.focal.h, x: Math.min(1 - im.focal.w, Math.max(0, edit.x - im.focal.w / 2)), y: Math.min(1 - im.focal.h, Math.max(0, edit.y - im.focal.h / 2)) } }))) };
    case "textPosition": return { spec: markManual(withRegion(spec, edit.region, (r) => ({ ...r, position: edit.position }))) };
    case "textFlow": return { spec: markManual(withRegion(spec, edit.region, (r) => ({ ...r, flow: edit.flow }))) };
    case "textAlign": return { spec: markManual(withRegion(spec, edit.region, (r) => ({ ...r, align: edit.align }))) };
    case "columns": return { spec: markManual(withRegion(spec, edit.region, (r) => ({ ...r, columns: edit.columns }))) };
    case "panel": return { spec: markManual(withRegion(spec, edit.region, (r) => ({ ...r, panel: edit.panel }))) };
    case "font": if (!(edit.font in FONT_TOKENS)) return { spec, note: "Unknown font" };
      return { spec: markManual({ ...spec, typography: { ...spec.typography, [edit.which === "heading" ? "headingFont" : "bodyFont"]: edit.font } }) };
    case "fontSize": {
      const min = MIN_BODY_PT[spec.bookType];
      const lo = Math.max(min, edit.bookBasePt - MAX_PAGE_PT_VARIATION), hi = edit.bookBasePt + MAX_PAGE_PT_VARIATION;
      const pt = Math.round(Math.min(hi, Math.max(lo, edit.bodyPt)) * 2) / 2;
      const note = edit.bodyPt < min ? `Text can't go below ${min}pt for this audience — extra text moves to the next page instead` : edit.bodyPt < lo || edit.bodyPt > hi ? `Page size stays within ±${MAX_PAGE_PT_VARIATION}pt of the book's ${edit.bookBasePt}pt for consistency` : undefined;
      return { spec: markManual({ ...spec, typography: { ...spec.typography, bodyPt: pt, headingPt: Math.max(pt, Math.round(pt * spec.typography.headingPt / spec.typography.bodyPt)) } }), note };
    }
    case "color": if (!/^\d{1,3}(\.\d+)? \d{1,3}(\.\d+)?% \d{1,3}(\.\d+)?%$/.test(edit.hsl)) return { spec, note: "Invalid color" };
      return { spec: markManual({ ...spec, colors: { ...spec.colors, [edit.key]: edit.hsl } }) };
    case "dropCap": return { spec: markManual({ ...spec, typography: { ...spec.typography, dropCap: edit.on } }) };
    case "decorations": return { spec: markManual({ ...spec, decorations: edit.kinds.slice(0, 3).map((k) => ({ ...k, density: 1 as const })) }) };
  }
}

export function hexToHsl(hex: string): string {
  const m = hex.replace("#", ""); const r = parseInt(m.slice(0, 2), 16) / 255, g = parseInt(m.slice(2, 4), 16) / 255, bb = parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, bb), min = Math.min(r, g, bb); const l = (max + min) / 2; let h = 0, s = 0;
  if (max !== min) { const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min); h = max === r ? (g - bb) / d + (g < bb ? 6 : 0) : max === g ? (bb - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
export function hslToHex(hsl: string): string {
  const [h, s, l] = hsl.replace(/%/g, "").split(/\s+/).map(Number); const S = s / 100, L = l / 100; const a = S * Math.min(L, 1 - L);
  const f = (n: number) => { const k = (n + h / 30) % 12; const c = L - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1))); return Math.round(c * 255).toString(16).padStart(2, "0"); };
  return `#${f(0)}${f(8)}${f(4)}`;
}
