// Deterministic geometric text flow: lines are laid into the free horizontal intervals of
// each text region after subtracting every image exclusion polygon. Works for any number of
// exclusions (center islands, scattered clusters) — no fake "absolute element" wrapping.
// It never drops or rewrites words and never shrinks type; unplaced words are returned as overflow.
import type { Box, PageTextRegionSpec, PageTypographySpec } from "./types.ts";
import { polygonBandExtent, type Pt } from "./shapes.ts";
import { FONT_TOKENS } from "./catalog.ts";

export type Token = { kind: "word"; text: string } | { kind: "para" };
export interface FontRef { family: string; pt: number; weight?: number }
/** Width in inches of `text` set in `font`. Browser: canvas measureText; tests: fixed-advance. */
export type Measurer = (text: string, font: FontRef) => number;

export interface Exclusion { box: Box; polygon: Pt[]; pad: number }
export interface Line {
  x: number; y: number; w: number; naturalWidth: number; baselineOffset: number; lineHeightIn: number;
  words: string[]; kind: "body" | "heading"; font: FontRef; justify: boolean; region: number;
  /** First word continues the previous line's last word (only when a single word was wider than any lane). */
  continuesWord?: boolean;
}
export interface DropCap { char: string; joinsNext: boolean; x: number; y: number; w: number; h: number; font: FontRef }
export interface FlowResult { lines: Line[]; next: number; carry?: string; headingDone: boolean; overflow: boolean; dropCap?: DropCap; regionsUsed: Box[] }

export const fixedAdvanceMeasurer = (advance = 0.5): Measurer => (text, f) => (text.length * f.pt * advance) / 72;

export function tokenize(body: string): Token[] {
  const out: Token[] = [];
  const paras = body.replace(/\r\n/g, "\n").split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);
  paras.forEach((p, i) => { if (i > 0) out.push({ kind: "para" }); for (const w of p.split(/\s+/)) if (w) out.push({ kind: "word", text: w }); });
  return out;
}
export const countWords = (tokens: Token[]) => tokens.filter((t) => t.kind === "word").length;

export function intersect(a: Box, b: Box): Box | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
}

function subtract(intervals: [number, number][], cut: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of intervals) {
    if (cut[1] <= a || cut[0] >= b) { out.push([a, b]); continue; }
    if (cut[0] > a) out.push([a, cut[0]]);
    if (cut[1] < b) out.push([cut[1], b]);
  }
  return out;
}

export function freeIntervals(region: Box, y0: number, y1: number, exclusions: Exclusion[]): [number, number][] {
  let iv: [number, number][] = [[region.x, region.x + region.w]];
  for (const e of exclusions) {
    const ext = polygonBandExtent(e.polygon, e.box, y0 - e.pad, y1 + e.pad);
    if (ext) iv = subtract(iv, [ext[0] - e.pad, ext[1] + e.pad]);
  }
  return iv;
}

export interface FlowInput {
  regions: PageTextRegionSpec[];
  live: Box;                  // safe area; regions are clipped to it
  keepOut?: Box[];            // e.g. spread gutter band — treated as rectangular exclusions
  exclusions: Exclusion[];
  tokens: Token[];
  start: number;              // token index to resume from
  carry?: string;             // remaining characters of a word split at the previous page end
  heading?: string;           // only on a unit's first page
  typography: PageTypographySpec;
  dropCap: boolean;           // applies only when start === 0
  measure: Measurer;
  minLaneIn?: number;
  columnGapIn?: number;
}

export function flowText(inp: FlowInput): FlowResult {
  const t = inp.typography;
  const body: FontRef = { family: FONT_TOKENS[t.bodyFont]?.css ?? t.bodyFont, pt: t.bodyPt, weight: 400 };
  const head: FontRef = { family: FONT_TOKENS[t.headingFont]?.css ?? t.headingFont, pt: t.headingPt, weight: 700 };
  const minLane = inp.minLaneIn ?? Math.max(0.9, (t.bodyPt * 7) / 72);
  const gap = inp.columnGapIn ?? 0.25;
  const space = (f: FontRef) => inp.measure(" ", f);
  const exclusions: Exclusion[] = [...inp.exclusions, ...(inp.keepOut ?? []).map((box) => ({ box, polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] as Pt[], pad: 0 }))];

  // Heading tokens are laid out first, with the heading font, then the body.
  const headTokens: Token[] = inp.heading ? tokenize(inp.heading) : [];
  let headIdx = 0;
  let idx = inp.start;
  const tokens = inp.tokens.slice();
  if (inp.carry !== undefined && tokens[inp.start]?.kind === "word") tokens[inp.start] = { kind: "word", text: inp.carry };
  let dropCap: DropCap | undefined;
  let dropPending = inp.dropCap && inp.start === 0 && tokens[0]?.kind === "word" && /[\p{L}\p{N}]/u.test((tokens[0] as { text: string }).text);
  let dropRemainder: string | null = null;

  const lines: Line[] = [];
  let splitCarry = inp.carry !== undefined;
  const regionsUsed: Box[] = [];
  const regions = inp.regions.slice().sort((a, b) => a.order - b.order);

  for (let ri = 0; ri < regions.length; ri++) {
    const clipped = intersect(regions[ri].box, inp.live);
    if (!clipped) continue;
    const cols = regions[ri].columns || 1;
    const colW = (clipped.w - gap * (cols - 1)) / cols;
    for (let c = 0; c < cols; c++) {
      const col: Box = { x: clipped.x + c * (colW + gap), y: clipped.y, w: colW, h: clipped.h };
      regionsUsed.push(col);
      let y = col.y;
      const localEx = exclusions.slice();
      while (true) {
        const inHeading = headIdx < headTokens.length;
        if (!inHeading && idx >= tokens.length && dropRemainder === null) break;
        const f = inHeading ? head : body;
        const lh = (f.pt * (inHeading ? 1.2 : t.lineHeight)) / 72;
        if (y + lh > col.y + col.h + 1e-6) break;
        // Drop cap: reserve a 3-line box at the start of the first body line.
        if (!inHeading && dropPending) {
          const lanes = freeIntervals(col, y, y + lh * 3, localEx).filter(([a, b]) => b - a >= minLane * 1.5);
          if (lanes.length && y + lh * 3 <= col.y + col.h + 1e-6) {
            const w0 = (tokens[idx] as { text: string }).text;
            const m = w0.match(/^([^\p{L}\p{N}]*[\p{L}\p{N}])/u)!;
            const capFont: FontRef = { family: head.family, pt: t.bodyPt * t.lineHeight * 2.7, weight: 700 };
            const cw = inp.measure(m[1], capFont) + 0.06;
            dropCap = { char: m[1], joinsNext: w0.length > m[1].length, x: lanes[0][0], y, w: cw, h: lh * 3, font: capFont };
            localEx.push({ box: { x: lanes[0][0], y, w: cw, h: lh * 3 - 0.01 }, polygon: [[0, 0], [1, 0], [1, 1], [0, 1]], pad: 0.04 });
            dropRemainder = w0.slice(m[1].length);
            idx++;
          }
          dropPending = false;
        }
        const lanes = freeIntervals(col, y, y + lh, localEx).filter(([a, b]) => b - a >= minLane);
        let placedAny = false;
        let paraBreak = false;
        for (const [a, b] of lanes) {
          const laneW = b - a;
          const words: string[] = [];
          let width = 0;
          const continuesWord = splitCarry;
          while (true) {
            let word: string | null = null;
            if (inHeading) { if (headIdx >= headTokens.length) break; const tk = headTokens[headIdx]; if (tk.kind === "para") { headIdx++; continue; } word = tk.text; }
            else if (dropRemainder !== null) { if (dropRemainder === "") { dropRemainder = null; continue; } word = dropRemainder; }
            else { if (idx >= tokens.length) break; const tk = tokens[idx]; if (tk.kind === "para") { if (words.length) { paraBreak = true; idx++; break; } idx++; continue; } word = tk.text; }
            const ww = inp.measure(word, f);
            const add = words.length ? space(f) + ww : ww;
            if (width + add <= laneW + 1e-6) {
              words.push(word); width += add;
              if (inHeading) headIdx++; else if (dropRemainder !== null) dropRemainder = null; else idx++;
              continue;
            }
            if (!words.length && ww > laneW && laneW >= col.w * 0.9) {
              // A single word wider than the full column: split by characters (no characters lost).
              let n = word.length; while (n > 1 && inp.measure(word.slice(0, n), f) > laneW) n--;
              words.push(word.slice(0, n)); width = inp.measure(word.slice(0, n), f);
              const rest = word.slice(n);
              if (inHeading) (headTokens[headIdx] as { text: string }).text = rest;
              else if (dropRemainder !== null) dropRemainder = rest;
              else tokens[idx] = { kind: "word", text: rest };
              lines.push({ x: a, y, w: laneW, naturalWidth: width, baselineOffset: lh * 0.78, lineHeightIn: lh, words: words.slice(), kind: inHeading ? "heading" : "body", font: f, justify: false, region: ri, continuesWord });
              words.length = 0; placedAny = true; splitCarry = true;
              break;
            }
            break;
          }
          if (words.length) {
            const align = regions[ri].align;
            lines.push({ x: a, y, w: laneW, naturalWidth: width, baselineOffset: lh * 0.78, lineHeightIn: lh, words, kind: inHeading ? "heading" : "body", font: f, justify: align === "justify" && !paraBreak, region: ri, continuesWord: continuesWord || undefined });
            splitCarry = false;
            placedAny = true;
          }
          if (paraBreak) break;
          const stillHeading = headIdx < headTokens.length;
          if (inHeading !== stillHeading) break; // heading finished: start body on a fresh line
          if (!stillHeading && idx >= tokens.length && dropRemainder === null) break;
        }
        y += lh;
        if (inHeading && headIdx >= headTokens.length) y += (t.paragraphSpacingPt * 1.5) / 72;
        if (paraBreak) y += t.paragraphSpacingPt / 72;
        void placedAny;
      }
    }
  }
  // Mark the last line of each paragraph / of the page as unjustified.
  if (lines.length) lines[lines.length - 1].justify = false;
  const overflow = headIdx < headTokens.length || idx < tokens.length || dropRemainder !== null;
  const pendingCap = dropRemainder !== null;
  if (pendingCap) { dropCap = undefined; idx -= 1; dropRemainder = null; } // cap never shown without its word
  const carry = splitCarry && tokens[idx]?.kind === "word" ? (tokens[idx] as { text: string }).text : undefined;
  return { lines, next: idx, carry, headingDone: headIdx >= headTokens.length, overflow, dropCap, regionsUsed };
}

/** Rebuild the plain word sequence a set of flow results displays (for preservation checks). */
export function reconstructWords(results: { lines: Line[]; dropCap?: DropCap }[]): string[] {
  const out: string[] = [];
  for (const r of results) {
    let capPending = r.dropCap?.char ?? null;
    for (const l of r.lines) {
      if (l.kind !== "body") continue;
      l.words.forEach((w, i) => {
        if (capPending !== null) { if (r.dropCap!.joinsNext) { out.push(capPending + w); capPending = null; return; } out.push(capPending); capPending = null; }
        if (i === 0 && l.continuesWord && out.length) out[out.length - 1] += w; else out.push(w);
      });
    }
    if (capPending !== null) out.push(capPending);
  }
  return out;
}
