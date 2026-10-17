// Stage C: Targeted naturalness rewriting (pure; the model is injected).
// Works only on an UNACCEPTED draft, before full validation and fenced acceptance. Edits are
// passage-level find/replace pairs; dialogue, names and numbers are protected; at most two
// attempts; a candidate is kept only if it is strictly better and introduces no new problems.
// Naturalness stays advisory: if anything fails, the original draft continues unchanged.
import type { NaturalnessFinding, NaturalnessMode } from "./naturalness.ts";
import { analyzeSection, type AnalyzeOptions } from "./naturalnessMetrics.ts";
import { deterministicValidation } from "../narrative/planning/validation.ts";
import { changeRatio } from "./textDiff.ts";

export const MAX_NATURALNESS_ATTEMPTS = 2;
export const DEFAULT_NATURALNESS_CHANGE_LIMIT = 0.2;
const REWRITABLE = new Set(["opening_recurrence", "figurative_density", "burstiness", "mechanical_pattern"]);

export interface Edit { find: string; replace: string }
export interface Prompt { system: string; user: string }
export type RewriteModel = (p: Prompt) => Promise<{ text: string }>;

export interface RewriteOptions extends AnalyzeOptions {
  mode: NaturalnessMode;
  writerVoice?: string;
  controls?: unknown;
  /** Max share of characters that may change (default 0.2). */
  changeLimit?: number;
}
export interface RewriteAttempt { attempt: number; edits: number; accepted: boolean; reason: string; scoreBefore: number; scoreAfter?: number }
export interface RewriteProposal { attempt: number; rawEdits: Edit[]; rejectedEdits: string[]; candidate: string; changeRatio: number }
export interface RewriteResult { text: string; changed: boolean; attempts: RewriteAttempt[]; proposals?: RewriteProposal[]; before: NaturalnessFinding[]; after: NaturalnessFinding[] }

/** Lower is better. Counts each flagged item, so fixing one stock phrase inside a finding still counts. */
export const naturalnessScore = (fs: NaturalnessFinding[]) => fs.reduce((s, f) => {
  const ev = f.evidence as { stockPhrases?: unknown[]; starters?: unknown[] };
  return s + (f.severity === "advisory" ? 2 : 1) + (ev?.stockPhrases?.length ?? 0) + (ev?.starters?.length ?? 0);
}, 0);

export function buildRewritePrompt(text: string, findings: NaturalnessFinding[], o: { writerVoice?: string } = {}): Prompt {
  const issues = findings.map((f, i) => `${i + 1}. [${f.category}] ${f.message}`).join("\n");
  return {
    system: [
      "You are a line editor making the smallest possible targeted improvements to prose.",
      "Fix ONLY the listed naturalness issues. Keep the writer's voice, plot, events, facts, names, numbers, dates, character knowledge and chronology exactly as they are.",
      "Never change text inside quotation marks (dialogue). Never add new facts, characters or events. Rewrite only the affected sentences.",
      o.writerVoice ? `Writer voice to preserve: ${o.writerVoice.slice(0, 600)}` : "",
      'Return JSON only: {"edits":[{"find":"exact text copied from the draft","replace":"improved text"}]}. Each find must appear exactly once.',
    ].filter(Boolean).join(" "),
    user: `ISSUES:\n${issues}\n\nDRAFT:\n---\n${text}\n---`,
  };
}

export function parseEdits(raw: string): Edit[] {
  const t = raw.replace(/```(?:json)?/gi, "");
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s < 0 || e <= s) return [];
  try {
    const o = JSON.parse(t.slice(s, e + 1));
    return (Array.isArray(o?.edits) ? o.edits : [])
      .filter((x: any) => typeof x?.find === "string" && typeof x?.replace === "string" && x.find.trim())
      .slice(0, 12).map((x: any) => ({ find: x.find, replace: x.replace }));
  } catch { return []; }
}

const QUOTE = /["\u201C\u201D]/;
const COMMON = new Set(["The","She","He","They","His","Her","Their","Its","It","And","But","Then","When","There","This","That","A","An","In","On","At","As","For","With","After","Before","Again","Now","We","You","I","Our","Your","So","Yet","Still","Even","Only","If","While","From","By","Of"]);
const properNouns = (s: string) => new Set((s.match(/\b[A-Z][a-z]+\b/g) ?? []).filter((w) => !COMMON.has(w)));
const digits = (s: string) => (s.match(/\d+/g) ?? []).join(",");

/** Why an edit is unsafe, or null if it is allowed. */
export function editViolation(text: string, e: Edit): string | null {
  const first = text.indexOf(e.find);
  if (first < 0) return "find_not_found";
  if (text.indexOf(e.find, first + 1) >= 0) return "find_not_unique";
  if (QUOTE.test(e.find) || QUOTE.test(e.replace)) return "dialogue_protected";
  if (digits(e.find) !== digits(e.replace)) return "numbers_changed";
  const after = properNouns(e.replace);
  for (const n of properNouns(e.find)) if (!after.has(n)) return `name_removed:${n}`;
  for (const n of after) if (!properNouns(e.find).has(n) && !text.includes(n)) return `name_added:${n}`;
  return null;
}

export function applyEdits(text: string, edits: Edit[]): { text: string; applied: number; rejected: string[] } {
  let out = text; let applied = 0; const rejected: string[] = [];
  for (const e of edits) {
    const v = editViolation(out, e);
    if (v) { rejected.push(v); continue; }
    out = out.replace(e.find, () => e.replace); applied++;
  }
  return { text: out, applied, rejected };
}

/** Share of the original actually modified (word-level diff vs the original baseline). */
export function charChangeRatio(original: string, revised: string): number { return changeRatio(original, revised); }

export async function runNaturalnessRewrite(draft: string, o: RewriteOptions, model: RewriteModel): Promise<RewriteResult> {
  const before = analyzeSection(draft, o);
  const res: RewriteResult = { text: draft, changed: false, attempts: [], proposals: [], before, after: before };
  if (o.mode !== "analyze_and_rewrite") return res;
  const limit = o.changeLimit ?? DEFAULT_NATURALNESS_CHANGE_LIMIT;
  const det = (t: string) => deterministicValidation(t, { controls: o.controls, motifs: o.protectedMotifs }).length;
  const baseDet = det(draft);
  let best = draft, bestFindings = before;
  for (let i = 1; i <= MAX_NATURALNESS_ATTEMPTS; i++) {
    const targets = bestFindings.filter((f) => REWRITABLE.has(f.category));
    if (!targets.length) break;
    const scoreBefore = naturalnessScore(bestFindings);
    let edits: Edit[] = [];
    try { edits = parseEdits((await model(buildRewritePrompt(best, targets, o))).text); }
    catch { res.attempts.push({ attempt: i, edits: 0, accepted: false, reason: "model_unavailable", scoreBefore }); break; }
    const { text: cand, applied, rejected } = applyEdits(best, edits);
    res.proposals!.push({ attempt: i, rawEdits: edits, rejectedEdits: rejected, candidate: cand, changeRatio: charChangeRatio(draft, cand) });
    const push = (accepted: boolean, reason: string, scoreAfter?: number) => res.attempts.push({ attempt: i, edits: applied, accepted, reason, scoreBefore, scoreAfter });
    if (!applied) { push(false, "no_safe_edits"); continue; }
    if (charChangeRatio(draft, cand) > limit) { push(false, "change_too_broad"); continue; }
    if (det(cand) > baseDet) { push(false, "introduced_validation_issue"); continue; }
    const after = analyzeSection(cand, o); const scoreAfter = naturalnessScore(after);
    if (scoreAfter >= scoreBefore) { push(false, "not_better", scoreAfter); continue; }
    push(true, "improved", scoreAfter);
    best = cand; bestFindings = after;
  }
  return { ...res, text: best, changed: best !== draft, after: bestFindings };
}

/** Author explicitly asked for a targeted rewrite of a held draft: runs the same bounded engine
 *  regardless of the book's automatic mode. Never accepts; caller saves a new candidate version. */
export function authorNaturalnessRewrite(draft: string, o: Omit<RewriteOptions, "mode">, model: RewriteModel): Promise<RewriteResult> {
  return runNaturalnessRewrite(draft, { ...o, mode: "analyze_and_rewrite" }, model);
}
