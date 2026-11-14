import type { ImageShape } from "./types.ts";

export type Pt = [number, number];

const ellipse = (rx = 0.5, ry = 0.5, n = 48): Pt[] => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [0.5 + rx * Math.cos(a), 0.5 + ry * Math.sin(a)] as Pt; });
const roundedRect = (rad = 0.12, n = 8): Pt[] => {
  const pts: Pt[] = [];
  const corners: [number, number, number][] = [[1 - rad, rad, -90], [1 - rad, 1 - rad, 0], [rad, 1 - rad, 90], [rad, rad, 180]];
  for (const [cx, cy, start] of corners) for (let i = 0; i <= n; i++) { const a = ((start + (90 * i) / n) * Math.PI) / 180; pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]); }
  return pts;
};
const blob = (k: number[], n = 40): Pt[] => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2;
  const rr = 0.42 + k[0] * Math.sin(a * 2 + k[1]) + k[2] * Math.sin(a * 3 + k[3]);
  return [0.5 + rr * Math.cos(a), 0.5 + rr * Math.sin(a)] as Pt;
});
const arch = (n = 24): Pt[] => {
  const pts: Pt[] = [[0, 1], [0, 0.5]];
  for (let i = 0; i <= n; i++) { const a = Math.PI + (Math.PI * i) / n; pts.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]); }
  pts.push([1, 0.5], [1, 1]);
  return pts;
};
const RECT: Pt[] = [[0, 0], [1, 0], [1, 1], [0, 1]];

/** One polygon per shape: used for the text-exclusion engine, CSS clip-path and shape-outside alike. */
export function shapePolygon(shape: ImageShape): Pt[] {
  switch (shape) {
    case "circle": return ellipse();
    case "oval": return ellipse(0.5, 0.5);
    case "rounded": return roundedRect();
    case "organic-blob-1": return blob([0.05, 0.4, 0.03, 1.2]);
    case "organic-blob-2": return blob([0.035, 2.1, 0.05, 0.3]);
    case "arch": return arch();
    default: return RECT;
  }
}

/** Circles stay circular: the box is squared around its center before rendering. */
export const forcesSquare = (shape: ImageShape) => shape === "circle" || shape === "square";

export const polygonCss = (pts: Pt[]) => `polygon(${pts.map(([x, y]) => `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`).join(", ")})`;
export const shapeClipCss = (shape: ImageShape) => polygonCss(shapePolygon(shape));

/** Horizontal extent of the polygon (in absolute units) inside band [y0, y1]; null when no overlap. */
export function polygonBandExtent(pts: Pt[], box: { x: number; y: number; w: number; h: number }, y0: number, y1: number): [number, number] | null {
  const abs = pts.map(([px, py]) => [box.x + px * box.w, box.y + py * box.h] as Pt);
  let lo = Infinity, hi = -Infinity;
  const consider = (x: number) => { lo = Math.min(lo, x); hi = Math.max(hi, x); };
  for (let i = 0; i < abs.length; i++) {
    const [ax, ay] = abs[i]; const [bx, by] = abs[(i + 1) % abs.length];
    if (ay >= y0 && ay <= y1) consider(ax);
    for (const yy of [y0, y1]) {
      if ((ay - yy) * (by - yy) < 0) consider(ax + ((yy - ay) / (by - ay)) * (bx - ax));
    }
  }
  return lo <= hi ? [lo, hi] : null;
}
