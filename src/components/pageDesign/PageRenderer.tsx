import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPE } from "react";
import type { PhysicalPage } from "../../../supabase/functions/_shared/pageDesign/paginate";
import { shapeClipCss, shapePolygon, polygonCss } from "../../../supabase/functions/_shared/pageDesign/shapes";
import { coverObjectPosition } from "../../../supabase/functions/_shared/pageDesign/checks";
import { intersect } from "../../../supabase/functions/_shared/pageDesign/textFlow";
import type { Box, PageImageSpec } from "@/types/pageDesign";

export interface PageRendererProps {
  page: PhysicalPage;
  /** CSS px per inch — fixed print coordinates are scaled to fit the preview. */
  scale: number;
  showGuides?: boolean;
  showBleed?: boolean;
  selectedSlot?: number | null;
  focalMode?: boolean;
  editable?: boolean;
  /** Use CSS float + shape-outside when the page geometry allows it (single edge exclusion). */
  preferCssFloat?: boolean;
  onSelectImage?: (slot: number | null) => void;
  onImageBox?: (slot: number, box: Box) => void;
  onFocal?: (slot: number, x: number, y: number) => void;
  onCssOverflow?: (pageKey: string) => void;
}

const hsl = (v: string, a = 1) => `hsl(${v} / ${a})`;

function treatmentStyle(t: PageImageSpec["treatment"]): CSSProperties {
  switch (t) {
    case "feathered": return { maskImage: "radial-gradient(closest-side, #000 72%, transparent 100%)", WebkitMaskImage: "radial-gradient(closest-side, #000 72%, transparent 100%)" };
    case "soft-fade-bottom": return { maskImage: "linear-gradient(#000 65%, transparent)", WebkitMaskImage: "linear-gradient(#000 65%, transparent)" };
    case "soft-fade-edge": return { maskImage: "radial-gradient(farthest-side, #000 80%, transparent)", WebkitMaskImage: "radial-gradient(farthest-side, #000 80%, transparent)" };
    case "background-blend": return { opacity: 0.55, mixBlendMode: "multiply" };
    default: return {};
  }
}

/** Single exclusion touching a region's left/right edge → real CSS shape-outside float is possible. */
export function cssFloatPlan(page: PhysicalPage): null | { region: Box; image: PageImageSpec; side: "left" | "right" } {
  const spec = page.spec; if (!spec || spec.images.length !== 1 || spec.textRegions.length !== 1 || spec.textRegions[0].columns !== 1 || spec.textRegions[0].overImage || spec.typography.dropCap) return null;
  const region = intersect(spec.textRegions[0].box, page.live); if (!region) return null;
  const im = spec.images[0];
  const ov = intersect(region, im.box); if (!ov) return null;
  if (ov.x <= region.x + 0.05 && ov.x + ov.w < region.x + region.w - 1) return { region, image: im, side: "left" };
  if (ov.x + ov.w >= region.x + region.w - 0.05 && ov.x > region.x + 1) return { region, image: im, side: "right" };
  return null;
}

export function PageRenderer({ page, scale, showGuides, showBleed, selectedSlot, focalMode, editable, preferCssFloat, onSelectImage, onImageBox, onFocal, onCssOverflow }: PageRendererProps) {
  const spec = page.spec;
  const bleed = showBleed && spec ? spec.print.bleedIn : 0;
  const W = page.canvas.w, H = page.canvas.h;
  const px = (v: number) => v * scale;
  const floatRef = useRef<HTMLDivElement>(null);
  const plan = preferCssFloat ? cssFloatPlan(page) : null;
  const [drag, setDrag] = useState<null | { slot: number; mode: "move" | "resize"; sx: number; sy: number; box: Box; cur: Box }>(null);

  useLayoutEffect(() => {
    const el = floatRef.current; if (!el || !plan) return;
    if (el.scrollHeight > el.clientHeight + 1) onCssOverflow?.(page.pageKey);
  });

  const paper = spec?.colors.paper ?? "0 0% 100%";
  const ink = spec?.colors.ink ?? "0 0% 10%";

  const start = (e: RPE, slot: number, mode: "move" | "resize", box: Box) => {
    if (!editable || focalMode) return;
    e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ slot, mode, sx: e.clientX, sy: e.clientY, box, cur: box });
  };
  const move = (e: RPE) => {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / scale, dy = (e.clientY - drag.sy) / scale;
    setDrag({ ...drag, cur: drag.mode === "move" ? { ...drag.box, x: drag.box.x + dx, y: drag.box.y + dy } : { ...drag.box, w: Math.max(0.5, drag.box.w + dx), h: Math.max(0.5, drag.box.h + dy) } });
  };
  const end = () => { if (drag) { onImageBox?.(drag.slot, drag.cur); setDrag(null); } };

  return (
    <div
      className="relative overflow-hidden shadow-lg select-none"
      style={{ width: px(W + 2 * bleed), height: px(H + 2 * bleed), background: hsl(paper) }}
      onPointerMove={move} onPointerUp={end} onPointerLeave={end}
      onClick={() => onSelectImage?.(null)}
      data-testid={`page-${page.numbers.join("-")}`}
    >
      <div className="absolute" style={{ left: px(bleed), top: px(bleed), width: px(W), height: px(H) }}>
        {page.kind === "parity" && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ color: hsl(ink, 0.35), fontSize: px(0.18) }}>
            {spec ? null : "Notes"}
          </div>
        )}
        {spec?.decorations.map((d, i) => <Decoration key={i} kind={d.kind} position={d.position} W={W} H={H} scale={scale} color={spec.colors.accent} margin={spec.print.safeMarginIn} />)}
        {spec?.images.map((im0, i) => {
          const im = drag?.slot === im0.slot ? { ...im0, box: drag.cur } : im0;
          const pos = page.objectPositions[i] ?? coverObjectPosition(im);
          const framed = im.treatment === "framed" || im.treatment === "decorative-border";
          const clip = shapeClipCss(im.shape);
          return (
            <div key={im.slot} className="absolute" style={{ left: px(im.box.x), top: px(im.box.y), width: px(im.box.w), height: px(im.box.h), zIndex: im.z, filter: im.treatment === "overlap" ? "drop-shadow(0 6px 12px hsl(0 0% 0% / 0.35))" : undefined, cursor: editable ? (focalMode ? "crosshair" : "move") : undefined, outline: selectedSlot === im.slot ? `2px solid ${hsl(spec.colors.accent)}` : undefined, outlineOffset: 2 }}
              onPointerDown={(e) => start(e, im.slot, "move", im.box)}
              onClick={(e) => {
                e.stopPropagation(); onSelectImage?.(im.slot);
                if (focalMode && onFocal) {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); const c = coverObjectPosition(im);
                  const bx = (e.clientX - r.left) / scale, by = (e.clientY - r.top) / scale;
                  const offX = (im.box.w - c.sw) * pos.px, offY = (im.box.h - c.sh) * pos.py;
                  onFocal(im.slot, Math.min(1, Math.max(0, (bx - offX) / c.sw)), Math.min(1, Math.max(0, (by - offY) / c.sh)));
                }
              }}
              data-testid={`image-slot-${im.slot}`}>
              {framed && <div className="absolute inset-0" style={{ clipPath: clip, background: hsl(spec.colors.accent), opacity: im.treatment === "decorative-border" ? 0.6 : 1 }} />}
              <div className="absolute" style={{ inset: framed ? px(0.08) : 0, clipPath: clip, background: hsl(ink, 0.08), ...treatmentStyle(im.treatment) }}>
                {im.url ? <img src={im.url} alt={im.alt} crossOrigin="anonymous" draggable={false} className="w-full h-full" style={{ objectFit: "cover", objectPosition: `${pos.px * 100}% ${pos.py * 100}%` }} />
                  : <div className="w-full h-full flex items-center justify-center text-center" style={{ fontSize: px(0.14), color: hsl(ink, 0.5) }}>Empty picture slot</div>}
              </div>
              {editable && selectedSlot === im.slot && !focalMode && <div className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize" style={{ background: hsl(spec.colors.accent) }} onPointerDown={(e) => start(e, im.slot, "resize", im.box)} aria-label="Resize picture" />}
            </div>
          );
        })}
        {spec?.textRegions.filter((r) => r.overImage && r.panel).map((r, i) => {
          const b = intersect(r.box, page.live); if (!b) return null;
          return <div key={`p${i}`} className="absolute rounded" style={{ left: px(b.x - 0.1), top: px(b.y - 0.1), width: px(b.w + 0.2), height: px(b.h + 0.2), background: hsl(spec.colors.panel, 0.9), zIndex: 5 }} />;
        })}
        {plan && page.flow ? (
          <div ref={floatRef} className="absolute overflow-hidden" data-testid="css-float-region" style={{ left: px(plan.region.x), top: px(plan.region.y), width: px(plan.region.w), height: px(plan.region.h), zIndex: 6, color: hsl(ink), fontFamily: page.flow.lines[0]?.font.family, fontSize: `${(spec!.typography.bodyPt / 72) * scale}px`, lineHeight: spec!.typography.lineHeight, textAlign: spec!.textRegions[0].align }}>
            {/* Zero-width spacer float pushes the shaped float down to the image's top edge. */}
            <div style={{ float: plan.side, width: 0.01, height: px(Math.max(0, plan.image.box.y - plan.region.y)) }} />
            {(() => { const f = floatShape(plan); return <div style={{ float: plan.side, clear: plan.side, width: px(f.w), height: px(plan.image.box.h), shapeOutside: f.css, shapeMargin: px(0.14) }} />; })()}
            {page.flow.lines.filter((l) => l.kind === "heading").map((l, i) => <div key={`h${i}`} style={{ fontFamily: l.font.family, fontWeight: 700, fontSize: `${(l.font.pt / 72) * scale}px`, color: hsl(spec!.colors.accent), lineHeight: 1.2 }}>{l.words.join(" ")}</div>)}
            <span>{joinBody(page)}</span>
          </div>
        ) : page.flow && (
          <div className="absolute inset-0" style={{ zIndex: 6, color: hsl(ink) }} data-testid="geometric-text">
            {page.flow.dropCap && <div className="absolute leading-none" style={{ left: px(page.flow.dropCap.x), top: px(page.flow.dropCap.y), fontFamily: page.flow.dropCap.font.family, fontWeight: 700, fontSize: `${(page.flow.dropCap.font.pt / 72) * scale}px`, color: hsl(spec!.colors.accent), lineHeight: 0.85 }}>{page.flow.dropCap.char}</div>}
            {page.flow.lines.map((l, i) => {
              const gaps = l.words.length - 1;
              const align = spec?.textRegions[l.region]?.align ?? "left";
              const extra = l.justify && gaps > 0 ? (l.w - l.naturalWidth) / gaps : 0;
              const off = align === "center" && !l.justify ? (l.w - l.naturalWidth) / 2 : 0;
              return <div key={i} className="absolute whitespace-pre" style={{ left: px(l.x + off), top: px(l.y), height: px(l.lineHeightIn), lineHeight: `${px(l.lineHeightIn)}px`, fontFamily: l.font.family, fontWeight: l.font.weight, fontSize: `${(l.font.pt / 72) * scale}px`, wordSpacing: extra ? `${px(extra)}px` : undefined, color: l.kind === "heading" ? hsl(spec!.colors.accent) : undefined }}>{l.words.join(" ")}</div>;
            })}
          </div>
        )}
        {spec && page.numbers.map((n, i) => {
          const pageX = page.kind === "spread" ? i * spec.print.trimWidthIn : 0; const left = n % 2 === 0;
          return <div key={n} className="absolute" style={{ top: px(H - spec.print.safeMarginIn * 0.6), left: px(pageX + (left ? spec.print.safeMarginIn : spec.print.trimWidthIn - spec.print.safeMarginIn - 0.3)), fontSize: px(0.11), color: hsl(ink, 0.6), zIndex: 7 }}>{n}</div>;
        })}
        {showGuides && spec && (
          <>
            <div className="absolute pointer-events-none border border-dashed" style={{ left: px(page.live.x), top: px(page.live.y), width: px(page.live.w), height: px(page.live.h), borderColor: hsl("190 80% 45%", 0.8), zIndex: 9 }} />
            {page.gutterBand && <div className="absolute pointer-events-none" style={{ left: px(page.gutterBand.x), top: 0, width: px(page.gutterBand.w), height: px(H), background: hsl("0 80% 55%", 0.12), zIndex: 9 }} />}
          </>
        )}
      </div>
      {showBleed && <div className="absolute pointer-events-none border" style={{ left: px(bleed), top: px(bleed), width: px(W), height: px(H), borderColor: hsl("0 80% 55%", 0.7), zIndex: 10 }} />}
    </div>
  );
}

/** shape-outside polygon in the float's own box, matching the picture's clip-path polygon. */
export function floatShape(plan: NonNullable<ReturnType<typeof cssFloatPlan>>) {
  const { region, image, side } = plan; const pad = 0.02;
  const w = side === "left" ? image.box.x + image.box.w - region.x + pad : region.x + region.w - image.box.x + pad;
  const originX = side === "left" ? image.box.x - region.x : pad;
  const pts = shapePolygon(image.shape).map(([x, y]) => [(originX + x * image.box.w) / w, y] as [number, number]);
  return { w, css: polygonCss(pts) };
}

function joinBody(page: PhysicalPage): string {
  const out: string[] = [];
  for (const l of page.flow!.lines) { if (l.kind !== "body") continue; l.words.forEach((w, i) => { if (i === 0 && l.continuesWord && out.length) out[out.length - 1] += w; else out.push(w); }); }
  return out.join(" ");
}

function Decoration({ kind, position, W, H, scale, color, margin }: { kind: string; position: string; W: number; H: number; scale: number; color: string; margin: number }) {
  const s = margin * scale * 0.6; const glyph = ({ stars: "✦", leaves: "❦", clouds: "☁", dots: "•", shapes: "◆", ornament: "❧", pattern: "✧", texture: "·", line: "", border: "" } as Record<string, string>)[kind] ?? "•";
  const st: CSSProperties = { color: `hsl(${color} / 0.55)`, fontSize: s, position: "absolute", zIndex: 2, pointerEvents: "none" };
  if (kind === "line") return <div style={{ ...st, left: margin * scale, right: margin * scale, top: position === "bottom" ? (H - margin * 0.5) * scale : margin * 0.5 * scale, height: 1, background: `hsl(${color} / 0.5)` }} />;
  if (kind === "border" || position === "border") return <div style={{ ...st, inset: margin * 0.35 * scale, border: `1px solid hsl(${color} / 0.45)`, borderRadius: 4 }} />;
  const at = position === "corners" ? [[0.15, 0.15], [W - 0.4, 0.15], [0.15, H - 0.4], [W - 0.4, H - 0.4]] : position === "bottom" ? [[W * 0.3, H - margin * 0.8], [W * 0.5, H - margin * 0.8], [W * 0.7, H - margin * 0.8]] : [[W * 0.3, margin * 0.15], [W * 0.5, margin * 0.15], [W * 0.7, margin * 0.15]];
  return <>{at.map(([x, y], i) => <span key={i} style={{ ...st, left: x * scale, top: y * scale }}>{glyph}</span>)}</>;
}
