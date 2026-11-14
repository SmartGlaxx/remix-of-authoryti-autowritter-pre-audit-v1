import type { Box, PageCompositionSpec, PageImageSpec } from "./types.ts";

export interface DesignIssue { level: "error" | "warning" | "info"; code: string; message: string; pageKey?: string; page?: number }

function hslToRgb(hsl: string): [number, number, number] {
  const [h, s, l] = hsl.replace(/%/g, "").split(/\s+/).map(Number);
  const S = s / 100, Lt = l / 100; const k = (n: number) => (n + h / 30) % 12; const a = S * Math.min(Lt, 1 - Lt);
  const f = (n: number) => Lt - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
export const relLuminance = ([r, g, b]: [number, number, number]) => { const c = (v: number) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b); };
export const contrastRatio = (l1: number, l2: number) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
export const hslLuminance = (hsl: string) => relLuminance(hslToRgb(hsl));
export const MIN_CONTRAST = 4.5;

/** Effective print resolution of an image placed with object-fit: cover. */
export function effectiveDpi(im: PageImageSpec): number | null {
  if (!im.naturalWidth || !im.naturalHeight) return null;
  const scale = Math.max(im.box.w / im.naturalWidth, im.box.h / im.naturalHeight); // inches per px
  return Math.round(1 / scale);
}

/** object-position fractions that centre the focal zone inside the box (cover crop). */
export function coverObjectPosition(im: PageImageSpec, override?: { x?: number; y?: number }): { px: number; py: number; sw: number; sh: number } {
  const a = (im.naturalWidth && im.naturalHeight) ? im.naturalWidth / im.naturalHeight : 1;
  const sw = Math.max(im.box.w, im.box.h * a), sh = Math.max(im.box.h, im.box.w / a);
  const fcx = im.focal.x + im.focal.w / 2, fcy = im.focal.y + im.focal.h / 2;
  const pos = (boxLen: number, sLen: number, fc: number) => sLen - boxLen < 1e-6 ? 0.5 : Math.min(1, Math.max(0, (sLen * fc - boxLen / 2) / (sLen - boxLen)));
  return { px: override?.x ?? pos(im.box.w, sw, fcx), py: override?.y ?? pos(im.box.h, sh, fcy), sw, sh };
}

export function focalRectOnPage(im: PageImageSpec, px: number, py: number): Box {
  const { sw, sh } = coverObjectPosition(im);
  const offX = (im.box.w - sw) * px, offY = (im.box.h - sh) * py;
  return { x: im.box.x + offX + im.focal.x * sw, y: im.box.y + offY + im.focal.y * sh, w: im.focal.w * sw, h: im.focal.h * sh };
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Spread gutter protection: shift the crop so the important subject avoids the binding. */
export function protectFocalFromGutter(im: PageImageSpec, gutter: Box): { px: number; py: number; protectedOk: boolean } {
  const base = coverObjectPosition(im);
  if (!overlaps(focalRectOnPage(im, base.px, base.py), gutter)) return { px: base.px, py: base.py, protectedOk: true };
  const opts = Array.from({ length: 21 }, (_, i) => i / 20).sort((a, b) => Math.abs(a - base.px) - Math.abs(b - base.px));
  for (const px of opts) if (!overlaps(focalRectOnPage(im, px, base.py), gutter)) return { px, py: base.py, protectedOk: true };
  return { px: base.px, py: base.py, protectedOk: false };
}

export function staticChecks(spec: PageCompositionSpec, currentTextHash: string): DesignIssue[] {
  const out: DesignIssue[] = [];
  const k = spec.pageKey;
  if (spec.textHash !== currentTextHash) out.push({ level: "warning", code: "TEXT_CHANGED", message: "The manuscript text changed since this page was designed; the layout was re-flowed with the current text.", pageKey: k });
  const paperL = hslLuminance(spec.colors.paper), inkL = hslLuminance(spec.colors.ink), panelL = hslLuminance(spec.colors.panel);
  if (contrastRatio(paperL, inkL) < MIN_CONTRAST) out.push({ level: "error", code: "LOW_CONTRAST", message: `Text/paper contrast ${contrastRatio(paperL, inkL).toFixed(1)}:1 is below ${MIN_CONTRAST}:1`, pageKey: k });
  for (const r of spec.textRegions) if (r.overImage && r.panel && contrastRatio(panelL, inkL) < MIN_CONTRAST) out.push({ level: "error", code: "LOW_PANEL_CONTRAST", message: "Text panel contrast is too low", pageKey: k });
  for (const im of spec.images) {
    if (!im.url) out.push({ level: "warning", code: "EMPTY_SLOT", message: `Picture slot ${im.slot + 1} has no illustration yet`, pageKey: k });
    const dpi = effectiveDpi(im);
    if (dpi === null && im.url) out.push({ level: "info", code: "DPI_UNKNOWN", message: `Resolution of picture ${im.slot + 1} not measured yet`, pageKey: k });
    else if (dpi !== null && dpi < 150) out.push({ level: "error", code: "LOW_DPI", message: `Picture ${im.slot + 1} prints at ~${dpi} DPI (needs ${spec.print.minDpi}); it will look blurry`, pageKey: k });
    else if (dpi !== null && dpi < spec.print.minDpi) out.push({ level: "warning", code: "DPI_BELOW_TARGET", message: `Picture ${im.slot + 1} prints at ~${dpi} DPI (target ${spec.print.minDpi})`, pageKey: k });
    if (im.treatment === "bleed" && spec.print.bleedIn < 0.1) out.push({ level: "warning", code: "BLEED_TOO_SMALL", message: "Bleed artwork needs at least 0.1 in bleed for print", pageKey: k });
  }
  return out;
}
