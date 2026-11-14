import { BOOK_TYPE_STYLES, DEFAULT_BODY_PT, DEFAULT_PRINT, FONT_TOKENS, getLayout, LAYOUT_CATALOG, MAX_PAGE_PT_VARIATION, MIN_BODY_PT, STYLE_FAMILY_DEFS, compatibleAccent, compatibleLayouts, shapeAllowed, treatmentAllowed, type LayoutDef } from "./catalog.ts";
import { forcesSquare } from "./shapes.ts";
import { hashString, rng } from "./prng.ts";
import { PAGE_DESIGN_SCHEMA_VERSION, type BookDesignSettings, type CompositionChoice, type CompositionMode, type ImageShape, type ImageTreatment, type LayoutStructure, type PageCompositionInput, type PageCompositionSpec, type PageDecorationSpec, type PageDesignBookType, type PageFeatures, type PageImageSpec, type PageTextRegionSpec, type ProvenanceSource, type StyleFamily } from "./types.ts";

export const textHash = (s: string) => hashString(s.replace(/\s+/g, " ").trim()).toString(36);

export function defaultSettings(bookType: PageDesignBookType, bookId: string): BookDesignSettings {
  return { schemaVersion: PAGE_DESIGN_SCHEMA_VERSION, styleFamily: BOOK_TYPE_STYLES[bookType][0], mode: "guided-random", seed: hashString(bookId), print: { ...DEFAULT_PRINT[bookType] }, bodyPt: DEFAULT_BODY_PT[bookType] };
}

const LEX: Record<PageFeatures["emotion"], RegExp> = {
  tense: /\b(fear|afraid|ran|run|scream|danger|dark|shadow|chase|trap|threat|blood|gun|knife|panic|heart pounded|deadline|risk)\b/gi,
  joyful: /\b(laugh|laughed|joy|happy|smile|smiled|cheer|dance|danced|celebrat\w*|delight\w*|giggl\w*)\b/gi,
  sad: /\b(cry|cried|tears|alone|lost|grief|miss(ed)?|sorrow|goodbye|lonely)\b/gi,
  tender: /\b(hug|hugged|gentle|soft|held|love|loved|warm|kiss)\b/gi,
  wonder: /\b(wonder|stars|magic\w*|glow\w*|sparkl\w*|amaz\w*|discover\w*|dream\w*)\b/gi,
  calm: /\b(quiet|still|calm|slow|rest|peace\w*|sleep\w*)\b/gi,
  neutral: /$^/g,
};

/** Deterministic text heuristics. These are labelled heuristic features — never presented as AI analysis. */
export function extractFeatures(text: string, images: PageCompositionInput["images"]): PageFeatures {
  const words = text.split(/\s+/).filter(Boolean).length;
  const paragraphs = Math.max(1, text.split(/\n+/).filter((p) => p.trim()).length);
  const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) || []).length);
  const quoted = (text.match(/[“"][^”"]*[”"]/g) || []).join(" ").split(/\s+/).filter(Boolean).length;
  let best: PageFeatures["emotion"] = "neutral", bestN = 0;
  for (const [k, re] of Object.entries(LEX) as [PageFeatures["emotion"], RegExp][]) { const n = (text.match(re) || []).length; if (n > bestN) { best = k; bestN = n; } }
  const intensity = Math.min(1, (bestN / Math.max(20, words)) * 12 + ((text.match(/!/g) || []).length / sentences) * 0.5);
  const avg = words / sentences;
  const pacing: PageFeatures["pacing"] = avg < 9 || intensity > 0.6 ? "dynamic" : avg > 18 ? "quiet" : "balanced";
  return { words, paragraphs, dialogueRatio: words ? quoted / words : 0, avgSentenceWords: Math.round(avg * 10) / 10, emotion: best, intensity: Math.round(intensity * 100) / 100, pacing, imageCount: images.length, focal: images.map((i) => i.focal ?? { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }) };
}

/** Rough text capacity (words) of a layout at a body size — used to prefer layouts that fit. */
export function layoutCapacity(def: LayoutDef, settings: BookDesignSettings): number {
  const { trimWidthIn: W, trimHeightIn: H, safeMarginIn: m } = settings.print;
  let area = 0;
  for (const r of def.regions) {
    const rx = Math.max(r.x * W, m), ry = Math.max(r.y * H, m), rx2 = Math.min((r.x + r.w) * W, (def.spread ? 2 : 1) * W - m), ry2 = Math.min((r.y + r.h) * H, H - m);
    let a = Math.max(0, rx2 - rx) * Math.max(0, ry2 - ry);
    if (!r.overImage) for (const sl of def.slots) { const ox = Math.max(0, Math.min(rx2, (sl.x + sl.w) * W) - Math.max(rx, sl.x * W)); const oy = Math.max(0, Math.min(ry2, (sl.y + sl.h) * H) - Math.max(ry, sl.y * H)); a -= ox * oy * 1.15; }
    area += Math.max(0, a);
  }
  const lineIn = (settings.bodyPt * 1.45) / 72; const wordIn = (settings.bodyPt * 0.5 * 5.8) / 72;
  return Math.floor((area / lineIn) / wordIn * 0.85);
}

export interface ChooseContext { input: PageCompositionInput; features: PageFeatures; mode: CompositionMode }

function rhythmPenalty(def: LayoutDef, recent: LayoutStructure[]) {
  const cats = recent.slice(-2).map((id) => getLayout(id)?.category);
  if (recent.slice(-3).includes(def.id)) return 0.05;
  return cats.includes(def.category) ? 0.35 : 1;
}

function featureWeight(def: LayoutDef, f: PageFeatures, cap: number) {
  let w = 1;
  if (cap < f.words) w *= 0.15; else if (cap > f.words * 4 && f.words > 0) w *= 0.6;
  if (f.intensity > 0.5 && def.category === "full") w *= 2.2;
  if (f.pacing === "dynamic" && (def.category === "side" || def.category === "multi")) w *= 1.6;
  if (f.pacing === "quiet" && (def.category === "top" || def.category === "bottom" || def.category === "center")) w *= 1.5;
  if ((f.emotion === "wonder" || f.emotion === "tender") && (def.defaultShape === "circle" || def.defaultShape.startsWith("organic") || def.defaultShape === "arch")) w *= 1.5;
  if (def.slots.length > 1 && f.imageCount >= def.slots.length) w *= 1.4;
  return w;
}

/** Deterministic chooser for consistent / guided-random / fully-randomized modes (seeded, reproducible). */
export function chooseDeterministic({ input, features, mode }: ChooseContext): { choice: CompositionChoice; source: ProvenanceSource } {
  const st = input.settings;
  const family = STYLE_FAMILY_DEFS[st.styleFamily];
  const cands = compatibleLayouts(input.bookType, input.images.length);
  const pool = cands.length ? cands : LAYOUT_CATALOG.filter((l) => l.slots.length === 1 && !l.spread);
  const pageRng = rng(hashString(`${st.seed}:${input.pageKey}:${mode}`));
  let layout: LayoutDef;
  if (mode === "consistent") {
    // Book-level rhythm: three layouts chosen once from the book seed, cycled by page index.
    const bookRng = rng(st.seed);
    const single = pool.filter((l) => l.slots.length <= Math.max(1, input.images.length));
    const cycle = [bookRng.pick(single), bookRng.pick(single), bookRng.pick(single)];
    layout = cycle[input.pageIndex % 3];
  } else if (mode === "fully-randomized") {
    layout = pageRng.pick(pool);
  } else {
    layout = pageRng.weighted(pool, (d) => featureWeight(d, features, layoutCapacity(d, st)) * rhythmPenalty(d, input.recentLayouts));
  }
  const shapeRng = mode === "consistent" ? rng(st.seed ^ 0x9e37) : pageRng;
  const shapes: ImageShape[] = layout.slots.map((_, i) => {
    if (i === 0 && shapeAllowed(st.styleFamily, layout.defaultShape, st.accentFamily) && mode !== "fully-randomized") return layout.defaultShape;
    return shapeRng.pick(family.shapes);
  });
  const bleedish = layout.slots.map((sl) => sl.bleed.length > 0);
  const treatments: ImageTreatment[] = layout.slots.map((_, i) => bleedish[i] ? "bleed" : shapeRng.pick(family.treatments.filter((t) => t !== "bleed")));
  const decoRng = rng(hashString(`${st.seed}:deco:${input.pageKey}`));
  const decorations: PageDecorationSpec[] = family.decorations.length && decoRng.next() < (input.bookType === "children" ? 0.6 : 0.3) ? [{ kind: decoRng.pick(family.decorations), position: decoRng.pick(["top", "bottom", "corners"] as const), density: 1 }] : [];
  return { choice: { layout: layout.id, shapes, treatments, dropCap: family.dropCap && input.pageIndex === 0 || (family.dropCap && mode !== "consistent" && pageRng.next() < 0.25), decorations }, source: mode === "fully-randomized" ? "randomized" : "deterministic" };
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Turns a validated choice into a full spec with physical geometry. Pure and reproducible. */
export function buildSpec(input: PageCompositionInput, choice: CompositionChoice, provenance: PageCompositionSpec["provenance"]): PageCompositionSpec {
  const def = getLayout(choice.layout)!;
  const st = input.settings; const p = st.print; const W = p.trimWidthIn, H = p.trimHeightIn;
  const fam = STYLE_FAMILY_DEFS[st.styleFamily];
  const accent = choice.accentFamily && compatibleAccent(st.styleFamily, choice.accentFamily) ? choice.accentFamily : st.accentFamily;
  const images: PageImageSpec[] = def.slots.map((sl, i) => {
    const asset = input.images[i];
    const shape = choice.shapes[i] ?? def.defaultShape;
    let box = { x: sl.x * W, y: sl.y * H, w: sl.w * W, h: sl.h * H };
    // Bleed sides extend artwork past the trim into the bleed.
    if (sl.bleed.includes("left")) { box.x -= p.bleedIn; box.w += p.bleedIn; }
    if (sl.bleed.includes("right")) box.w += p.bleedIn;
    if (sl.bleed.includes("top")) { box.y -= p.bleedIn; box.h += p.bleedIn; }
    if (sl.bleed.includes("bottom")) box.h += p.bleedIn;
    if (forcesSquare(shape) && !sl.bleed.length) { const d = Math.min(box.w, box.h); box = { x: box.x + (box.w - d) / 2, y: box.y + (box.h - d) / 2, w: d, h: d }; }
    return { slot: i, url: asset?.url ?? "", alt: asset?.alt ?? "", shape: sl.bleed.length ? "rectangle" : shape, treatment: choice.treatments[i] ?? "borderless", box, bleed: sl.bleed, focal: asset?.focal ?? { x: 0.3, y: 0.25, w: 0.4, h: 0.5 }, naturalWidth: asset?.naturalWidth, naturalHeight: asset?.naturalHeight, z: sl.z ?? 1 };
  });
  const textRegions: PageTextRegionSpec[] = def.regions.map((r, i) => ({
    order: i, box: { x: r.x * W, y: r.y * H, w: r.w * W, h: r.h * H }, flow: (i === 0 && choice.flow) || r.flow, position: (i === 0 && choice.position) || r.position,
    align: input.bookType === "children" ? "left" : (input.bookType === "magazine" ? "justify" : "left"), columns: input.bookType === "magazine" && r.w * W > 6 && !r.overImage ? 2 : (r.columns ?? 1), overImage: !!r.overImage, panel: !!r.panel || (!!r.overImage && input.bookType !== "children"),
  }));
  const bodyPt = clamp(st.bodyPt, MIN_BODY_PT[input.bookType], st.bodyPt + MAX_PAGE_PT_VARIATION);
  return {
    schemaVersion: PAGE_DESIGN_SCHEMA_VERSION, pageKey: input.pageKey, bookType: input.bookType, styleFamily: st.styleFamily, accentFamily: accent,
    layout: def.id, isSpread: !!def.spread, seed: hashString(`${st.seed}:${input.pageKey}`), provenance, images, textRegions,
    typography: { headingFont: fam.headingFont, bodyFont: fam.bodyFont, bodyPt, headingPt: Math.round(bodyPt * (input.bookType === "children" ? 1.5 : 1.9)), lineHeight: fam.lineHeight, paragraphSpacingPt: Math.round(bodyPt * 0.6), letterSpacingEm: 0, dropCap: choice.dropCap },
    colors: { ...fam.palettes[0] }, decorations: choice.decorations.filter((d) => fam.decorations.includes(d.kind) || (accent && STYLE_FAMILY_DEFS[accent].decorations.includes(d.kind))), print: { ...p }, textHash: textHash(input.text),
  };
}

export function composeDeterministic(input: PageCompositionInput, mode: CompositionMode = input.settings.mode, fallbackReason?: string): PageCompositionSpec {
  const effective = mode === "dynamic-ai" || mode === "manual" ? "guided-random" : mode;
  const { choice, source } = chooseDeterministic({ input, features: extractFeatures(input.text, input.images), mode: effective });
  return buildSpec(input, choice, { source: fallbackReason ? "deterministic-fallback" : source, mode, fallbackReason, createdAt: new Date(0).toISOString(), rationale: `Seeded ${effective} choice from heuristic text features` });
}

export { FONT_TOKENS, treatmentAllowed, shapeAllowed };
export type { StyleFamily };
