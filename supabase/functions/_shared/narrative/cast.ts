// Planned-cast gating. Pure, no I/O.
// A character can be in the book's outline without being eligible for the current scene.
// Planned debut = explicit `firstAppearance` on the outline character, else the first outline
// section whose title/description/summary names them (full name, unique surname, or unique
// given name). Unknown debut = no evidence of a later entrance, so the character stays eligible.
import { toPosition, type StoryPosition } from "./rules.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export type DebutMap = Map<string, StoryPosition | null>; // key = outline id ?? name

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (text: string, token: string) => new RegExp(`(^|[^\\p{L}])${esc(token)}($|[^\\p{L}])`, "u").test(text);
export const castKey = (c: Row) => String(c?.id || c?.name || "");

/** Name tokens that safely identify one character among the whole cast. */
function identifyingTokens(cast: Row[]): Map<string, string[]> {
  const count = new Map<string, number>();
  const toks = (n: string) => n.trim().split(/\s+/).filter((t) => t.length >= 3 && /^\p{Lu}/u.test(t));
  for (const c of cast) for (const t of new Set(toks(String(c?.name ?? "")))) count.set(t, (count.get(t) ?? 0) + 1);
  const out = new Map<string, string[]>();
  for (const c of cast) {
    const name = String(c?.name ?? "").trim();
    if (!name) continue;
    out.set(castKey(c), [name, ...toks(name).filter((t) => count.get(t) === 1)]);
  }
  return out;
}

export function plannedDebuts(cast: Row[], chapters: Row[]): DebutMap {
  const tokens = identifyingTokens(cast);
  const out: DebutMap = new Map();
  for (const c of cast) {
    const key = castKey(c);
    if (!key) continue;
    const fa = c?.firstAppearance;
    if (fa && typeof fa.chapterIndex === "number") { out.set(key, { chapterIndex: fa.chapterIndex, subsectionIndex: fa.subsectionIndex ?? 0 }); continue; }
    let found: StoryPosition | null = null;
    const ts = tokens.get(key) ?? [];
    outer: for (let ci = 0; ci < (chapters ?? []).length; ci++) {
      const subs = chapters[ci]?.subsections ?? [];
      for (let si = 0; si < subs.length; si++) {
        const s = subs[si] ?? {};
        const text = [s.title, s.description, s.summary].filter((x) => typeof x === "string").join(" \n ");
        if (ts.some((t) => has(text, t))) { found = { chapterIndex: ci, subsectionIndex: si }; break outer; }
      }
    }
    out.set(key, found);
  }
  return out;
}

export type CastStatus = "established" | "enters_now" | "future" | "unplaced";
/** established = planned debut strictly before p; enters_now = this section; unplaced = outline never places them (eligible, never claimed as on-page). */
export function castStatus(debut: StoryPosition | null | undefined, position: StoryPosition): CastStatus {
  if (!debut) return "unplaced";
  const d = toPosition(debut), p = toPosition(position);
  return d < p ? "established" : d === p ? "enters_now" : "future";
}
