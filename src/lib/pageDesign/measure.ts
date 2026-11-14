import type { Measurer } from "../../../supabase/functions/_shared/pageDesign/textFlow";

/** Canvas-backed measurer (inches). Results are cached per font+text. */
export function createCanvasMeasurer(): Measurer {
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
  const ctx = canvas?.getContext("2d") ?? null;
  const cache = new Map<string, number>();
  return (text, f) => {
    const key = `${f.family}|${f.pt}|${f.weight ?? 400}|${text}`;
    const hit = cache.get(key); if (hit !== undefined) return hit;
    let w: number;
    if (ctx) { ctx.font = `${f.weight ?? 400} ${f.pt}pt ${f.family}`; w = ctx.measureText(text).width / 96; }
    else w = (text.length * f.pt * 0.5) / 72;
    // canvas px at "Npt" uses 96 px/in, so px/96 = inches.
    cache.set(key, w); return w;
  };
}
