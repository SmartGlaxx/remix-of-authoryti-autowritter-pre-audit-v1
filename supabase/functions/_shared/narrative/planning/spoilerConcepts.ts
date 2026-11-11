// Concept-based spoiler detection (pure). A spoiler is a CONCEPT, not a word:
// each future reveal has 1–2 trigger keywords plus a concept sentence (≥10 words) describing the secret.
// 1. A keyword hit is only a candidate. 2. Keywords the chapter's own approved plan already uses are planned, never spoilers.
// 3. Remaining candidates go, with their concept sentence, to one AI judge that decides if the secret itself is given away.
import type { MasterPlanSkeleton } from "./engine.ts";

export const MIN_CONCEPT_WORDS = 10;
export interface SpoilerConcept { revealId: string; keywords: string[]; concept: string }
export interface SpoilerCandidate { revealId: string; keyword: string; concept: string; excerpt: string }

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (k: string) => new RegExp(`(^|[^a-z0-9])${esc(norm(k))}([^a-z0-9]|$)`);

/** Concept sentence for a reveal: its own `concept` when ≥10 words, else the reveal summary (if ≥10 words). */
export function conceptOf(r: { concept?: string; summary?: string }): string {
  const c = (r.concept ?? "").trim();
  if (words(c) >= MIN_CONCEPT_WORDS) return c;
  const s = (r.summary ?? "").trim();
  return words(s) >= MIN_CONCEPT_WORDS ? s : "";
}

/** Reveals scheduled after chapter `ch`, as keyword + concept pairs. A reveal without a usable concept cannot be judged and is skipped. */
export function futureSpoilerConcepts(s: Pick<MasterPlanSkeleton, "reveals">, ch: number): SpoilerConcept[] {
  return (s.reveals ?? []).filter((r) => r.revealChapter > ch).map((r: any) => ({
    revealId: String(r.id), concept: conceptOf(r),
    keywords: [...(Array.isArray(r.keywords) ? r.keywords : []), ...(r.secretTerms ?? [])].map((k: unknown) => String(k ?? "").trim())
      .filter((k: string) => k && (k.includes(" ") || k.length >= 4)).slice(0, 4),
  })).filter((c) => c.concept && c.keywords.length);
}

/** Keyword hits in `text` that the chapter's approved plan does not already contain. */
export function spoilerCandidates(text: string, concepts: SpoilerConcept[], approvedPlanText: string): SpoilerCandidate[] {
  const hay = norm(text), plan = norm(approvedPlanText);
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  const out: SpoilerCandidate[] = [];
  for (const c of concepts) for (const k of c.keywords) {
    const re = wordRe(k);
    if (re.test(plan) || !re.test(hay)) continue; // planned here, or not mentioned
    const excerpt = sentences.filter((s) => re.test(norm(s))).slice(0, 3).join(" ").slice(0, 600);
    out.push({ revealId: c.revealId, keyword: k, concept: c.concept, excerpt });
    break; // one candidate per reveal is enough for the judge
  }
  return out;
}

export function buildSpoilerJudgePrompt(cands: SpoilerCandidate[]): { system: string; user: string } {
  return {
    system: "You judge spoilers in a novel plan. A passage SPOILS a secret only if a reader of it would understand the secret itself. Sharing a word, name, object or place with the secret, hints and foreshadowing are NOT spoilers. Output JSON only.",
    user: cands.map((c, i) => `${i + 1}. SECRET (revealed later): ${c.concept}\n   PASSAGE (mentions "${c.keyword}"): ${c.excerpt}`).join("\n\n") +
      `\n\nFor each numbered item decide if the passage gives the secret away.\nJSON: {"verdicts":[{"item":1,"spoils":false,"why":""}]}`,
  };
}

/** Reveal ids the judge says are given away. Unparseable output fails closed (all candidates count as spoilers). */
export function parseSpoilerJudge(raw: string, cands: SpoilerCandidate[]): { revealId: string; why: string }[] {
  try {
    const m = raw.match(/\{[\s\S]*\}/); const o = JSON.parse(m ? m[0] : raw);
    const v: any[] = Array.isArray(o?.verdicts) ? o.verdicts : [];
    return cands.flatMap((c, i) => { const x = v.find((y) => Number(y?.item) === i + 1); if (!x) return [{ revealId: c.revealId, why: "no verdict" }]; return x.spoils === true ? [{ revealId: c.revealId, why: String(x.why ?? "") }] : []; });
  } catch { return cands.map((c) => ({ revealId: c.revealId, why: "judge output unreadable" })); }
}
