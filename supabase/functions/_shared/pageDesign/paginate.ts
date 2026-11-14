// Turns content units (sections) + their compositions into physical pages.
// Page 1 is a right-hand (recto) page; even pages are left. Spreads always occupy an
// even-left + odd-right pair: when a spread would start on an odd page, a page is inserted.
import type { Box, PageCompositionSpec, PageImageSpec } from "./types.ts";
import { flowText, tokenize, countWords, type FlowResult, type Measurer, type Exclusion } from "./textFlow.ts";
import { shapePolygon } from "./shapes.ts";
import { coverObjectPosition, protectFocalFromGutter, type DesignIssue } from "./checks.ts";

export interface ContentUnit { pageKey: string; heading?: string; text: string }
export type PageKind = "designed" | "continuation" | "parity" | "spread";
export interface PhysicalPage {
  numbers: number[];           // one number, or [even, odd] for a spread
  kind: PageKind;
  pageKey: string;             // owning content unit ("" for parity fillers)
  spec: PageCompositionSpec | null;
  flow: FlowResult | null;
  live: Box;
  canvas: { w: number; h: number };
  gutterBand?: Box;
  objectPositions: { px: number; py: number }[];
}
export interface PaginationResult { pages: PhysicalPage[]; issues: DesignIssue[]; wordsIn: number; wordsPlaced: number }

export const isLeftPage = (n: number) => n % 2 === 0;

export function liveArea(spec: Pick<PageCompositionSpec, "print">, pageNumber: number, spread: boolean): { live: Box; canvas: { w: number; h: number }; gutterBand?: Box } {
  const p = spec.print; const W = p.trimWidthIn, H = p.trimHeightIn, m = p.safeMarginIn;
  if (spread) return { live: { x: m, y: m, w: 2 * W - 2 * m, h: H - 2 * m }, canvas: { w: 2 * W, h: H }, gutterBand: { x: W - p.gutterIn, y: -p.bleedIn, w: 2 * p.gutterIn, h: H + 2 * p.bleedIn } };
  const left = isLeftPage(pageNumber); // binding on the right of a left page, on the left of a right page
  return { live: { x: m + (left ? 0 : p.gutterIn), y: m, w: W - 2 * m - p.gutterIn, h: H - 2 * m }, canvas: { w: W, h: H } };
}

export function exclusionsFor(spec: PageCompositionSpec): Exclusion[] {
  const overRegions = spec.textRegions.filter((r) => r.overImage).map((r) => r.box);
  return spec.images.filter((im) => !overRegions.some((b) => im.box.x <= b.x && im.box.y <= b.y && im.box.x + im.box.w >= b.x + b.w && im.box.y + im.box.h >= b.y + b.h))
    .map((im) => ({ box: im.box, polygon: shapePolygon(im.shape), pad: im.treatment === "framed" || im.treatment === "decorative-border" ? 0.2 : 0.14 }));
}

export function continuationSpec(from: PageCompositionSpec): PageCompositionSpec {
  const p = from.print;
  return { ...from, layout: from.layout, isSpread: false, images: [], decorations: [], textRegions: [{ order: 0, box: { x: 0, y: 0, w: p.trimWidthIn, h: p.trimHeightIn }, flow: "block", position: "top", align: from.textRegions[0]?.align ?? "left", columns: from.textRegions.some((r) => r.columns > 1) ? 2 : 1, overImage: false, panel: false }], typography: { ...from.typography, dropCap: false } };
}

export function paginate(units: ContentUnit[], specs: Map<string, PageCompositionSpec>, measure: Measurer, opts: { parityFiller?: "notes" | "decorative" } = {}): PaginationResult {
  const pages: PhysicalPage[] = []; const issues: DesignIssue[] = [];
  let n = 1, wordsIn = 0, wordsPlaced = 0;
  for (const u of units) {
    const spec = specs.get(u.pageKey);
    const tokens = tokenize(u.text); wordsIn += countWords(tokens);
    if (!spec) { issues.push({ level: "error", code: "NO_SPEC", message: `No design for ${u.pageKey}`, pageKey: u.pageKey }); continue; }
    if (spec.isSpread && !isLeftPage(n)) {
      const geo = liveArea(spec, n, false);
      pages.push({ numbers: [n], kind: "parity", pageKey: "", spec: null, flow: null, live: geo.live, canvas: geo.canvas, objectPositions: [] });
      issues.push({ level: "info", code: "PARITY_PAGE_INSERTED", message: `Inserted ${opts.parityFiller ?? "decorative"} page ${n} so the spread starts on a left page`, page: n, pageKey: u.pageKey });
      n++;
    }
    const geo = liveArea(spec, n, spec.isSpread);
    const objectPositions = spec.images.map((im: PageImageSpec) => {
      if (spec.isSpread && geo.gutterBand && im.box.x < geo.gutterBand.x + geo.gutterBand.w && im.box.x + im.box.w > geo.gutterBand.x) {
        const r = protectFocalFromGutter(im, geo.gutterBand);
        if (!r.protectedOk) issues.push({ level: "warning", code: "SUBJECT_IN_GUTTER", message: `The important subject of picture ${im.slot + 1} cannot be moved out of the binding gutter`, pageKey: u.pageKey });
        return { px: r.px, py: r.py };
      }
      const c = coverObjectPosition(im); return { px: c.px, py: c.py };
    });
    let flow = flowText({ regions: spec.textRegions, live: geo.live, keepOut: geo.gutterBand ? [geo.gutterBand] : [], exclusions: exclusionsFor(spec), tokens, start: 0, heading: u.heading, typography: spec.typography, dropCap: spec.typography.dropCap, measure });
    pages.push({ numbers: spec.isSpread ? [n, n + 1] : [n], kind: spec.isSpread ? "spread" : "designed", pageKey: u.pageKey, spec, flow, live: geo.live, canvas: geo.canvas, gutterBand: geo.gutterBand, objectPositions });
    n += spec.isSpread ? 2 : 1;
    let placed = countPlaced(flow);
    wordsPlaced += placed;
    if (!flow.headingDone) issues.push({ level: "warning", code: "HEADING_SPLIT", message: "The heading does not fit its region and continues on the next page", pageKey: u.pageKey });
    let added = 0;
    while (flow.overflow) {
      const cont = continuationSpec(spec);
      const g = liveArea(cont, n, false);
      const next = flowText({ regions: cont.textRegions, live: g.live, exclusions: [], tokens, start: flow.next, carry: flow.carry, heading: flow.headingDone ? undefined : u.heading, typography: cont.typography, dropCap: false, measure });
      placed = countPlaced(next);
      if (placed === 0 && next.overflow) { issues.push({ level: "error", code: "UNPLACEABLE_TEXT", message: "Text cannot be placed even on a full continuation page at the readable size", pageKey: u.pageKey }); break; }
      pages.push({ numbers: [n], kind: "continuation", pageKey: u.pageKey, spec: cont, flow: next, live: g.live, canvas: g.canvas, objectPositions: [] });
      wordsPlaced += placed; n++; added++; flow = next;
    }
    if (added) issues.push({ level: "info", code: "REPAGINATED", message: `Text overflowed its designed page; ${added} continuation page${added > 1 ? "s were" : " was"} added (no text hidden or shrunk)`, pageKey: u.pageKey });
  }
  if (wordsPlaced !== wordsIn) issues.push({ level: "error", code: "WORD_COUNT_MISMATCH", message: `Placed ${wordsPlaced} of ${wordsIn} words` });
  return { pages, issues, wordsIn, wordsPlaced };
}

function countPlaced(f: FlowResult): number {
  // Words fully or partly placed; a character-split word counts once (at its first fragment).
  let c = 0; let capPending = f.dropCap ? f.dropCap.joinsNext : false;
  if (f.dropCap && !f.dropCap.joinsNext) c++;
  for (const l of f.lines) { if (l.kind !== "body") continue; l.words.forEach((_, i) => { if (capPending) { capPending = false; c++; return; } if (i === 0 && l.continuesWord) return; c++; }); }
  return c;
}
