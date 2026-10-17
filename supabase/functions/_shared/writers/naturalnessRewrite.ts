// Stage C: Targeted naturalness rewriting (pure; the model is injected).
// Works only on an UNACCEPTED draft, before full validation and fenced acceptance. Edits are
// passage-level find/replace pairs; dialogue, names and numbers are protected; at most two
// attempts; a candidate is kept only if it is strictly better and introduces no new problems.
// Naturalness stays advisory: if anything fails, the original draft continues unchanged.
import type { NaturalnessFinding, NaturalnessMode } from "./naturalness.ts";
import { analyzeSection, rhythmStats, type AnalyzeOptions } from "./naturalnessMetrics.ts";
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
  /** Established character/place names from canon; protected in addition to mid-sentence capitals. */
  knownNames?: string[];
}
export interface RewriteAttempt { attempt: number; edits: number; accepted: boolean; reason: string; scoreBefore: number; scoreAfter?: number }
export interface RewriteProposal { attempt: number; rawEdits: Edit[]; rejectedEdits: string[]; candidate: string; changeRatio: number }
export interface RewriteResult { text: string; changed: boolean; attempts: RewriteAttempt[]; proposals?: RewriteProposal[]; before: NaturalnessFinding[]; after: NaturalnessFinding[]; unresolved: string[] }

/** Lower is better. Counts each flagged item, so fixing one stock phrase inside a finding still counts. */
export const naturalnessScore = (fs: NaturalnessFinding[]) => fs.reduce((s, f) => {
  const ev = f.evidence as { stockPhrases?: unknown[]; starters?: unknown[]; templates?: { count: number }[]; duplicates?: { sentences?: { count: number }[]; paragraphs?: { count: number }[] } };
  const dup = [...(ev?.duplicates?.sentences ?? []), ...(ev?.duplicates?.paragraphs ?? [])].reduce((a, d) => a + d.count - 1, 0);
  return s + (f.severity === "advisory" ? 2 : 1) + (ev?.stockPhrases?.length ?? 0) + (ev?.starters?.length ?? 0)
    + (ev?.templates?.length ?? 0) * 2 + dup * 2;
}, 0);

export function buildRewritePrompt(text: string, findings: NaturalnessFinding[], o: { writerVoice?: string } = {}): Prompt {
  const issues = findings.map((f, i) => `${i + 1}. [${f.category}] ${f.message}`).join("\n");
  return {
    system: [
      "You are a line editor making targeted improvements to prose.",
      "Repetition must be fixed STRUCTURALLY, not by synonym or word-order swaps: replacing many identical sentence openings with many openings that share one new shape (e.g. 'As the X, she waited' -> 'The X while she waited') is a failure and will be rejected.",
      "Instead: delete filler beats that add nothing, merge a beat into the neighbouring sentence, split or recombine sentences, let a character action or a concrete observation carry the moment, and vary where each sentence enters. Remove stock phrases (e.g. 'At the end of the day', 'The truth is') rather than rephrasing them, and delete or rework repeated identical sentences.",
      "Do not force metaphors or arbitrary variety; keep deliberate parallelism and motifs. Preserve the writer's identity and pacing.",
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
["Nothing","Nobody","Someone","Somebody","Something","Everything","Everyone","Anything","Anyone","None","No","Not","Maybe","Perhaps","Outside","Inside","Tomorrow","Tonight","Today","Okay","Yes","What","Why","How","Where","Who","Because","Though","Although","Once","Some","All","Each","Every","Neither","Either","Both","Here","Never","Always","Somewhere","Finally","Later","Soon","Sometimes","Instead","Until","Since","Like","Just","Do","Did","Is","Was","Were","My","Me","Us","Him","Them","These","Those","One","Two","Three"].forEach((w) => COMMON.add(w));
const capsWords = (s: string) => (s.match(/\b[A-Z][a-z]+\b/g) ?? []).filter((w) => !COMMON.has(w));
/** Words capitalised mid-sentence (not after . ! ? or a quote) — capitalisation at a sentence
 *  start alone is never evidence of a name. */
const midSentenceCaps = (s: string) => new Set([...s.matchAll(/(?<![.!?"\u201C\u201D\n]\s*)(?<=[\w,;:\u2014-]\s*)\b([A-Z][a-z]+)\b/g)].map((m) => m[1]).filter((w) => !COMMON.has(w)));
function nameSet(text: string, known: string[] = []) {
  const n = midSentenceCaps(text);
  // A sentence-start capital counts only if its lowercase form never appears as an ordinary word.
  for (const w of capsWords(text)) if (!new RegExp(`\\b${w.toLowerCase()}\\b`).test(text)) n.add(w);
  for (const k of known) for (const t of k.split(/\s+/)) if (/^[A-Z]/.test(t)) n.add(t);
  return n;
}
const digits = (s: string) => (s.match(/\d+/g) ?? []).join(",");

/** Why an edit is unsafe, or null if it is allowed. */
export function editViolation(text: string, e: Edit, knownNames: string[] = []): string | null {
  const first = text.indexOf(e.find);
  if (first < 0) return "find_not_found";
  if (text.indexOf(e.find, first + 1) >= 0) return "find_not_unique";
  if (QUOTE.test(e.find) || QUOTE.test(e.replace)) return "dialogue_protected";
  if (digits(e.find) !== digits(e.replace)) return "numbers_changed";
  const names = nameSet(text, knownNames);
  const inFind = new Set(capsWords(e.find).filter((w) => names.has(w)));
  const replaceWords = new Set(capsWords(e.replace));
  for (const n of inFind) if (!replaceWords.has(n)) return `name_removed:${n}`;
  // A new name is a word the replacement capitalises mid-sentence (or a known name) that the draft never had.
  const added = new Set([...midSentenceCaps(e.replace), ...capsWords(e.replace).filter((w) => names.has(w))]);
  for (const n of added) if (!text.includes(n)) return `name_added:${n}`;
  return null;
}

export function applyEdits(text: string, edits: Edit[], knownNames: string[] = []): { text: string; applied: number; rejected: string[] } {
  let out = text; let applied = 0; const rejected: string[] = [];
  for (const e of edits) {
    const v = editViolation(out, e, knownNames);
    if (v) { rejected.push(v); continue; }
    out = out.replace(e.find, () => e.replace); applied++;
  }
  return { text: out, applied, rejected };
}

/** Share of the original actually modified (word-level diff vs the original baseline). */
export function charChangeRatio(original: string, revised: string): number { return changeRatio(original, revised); }

export async function runNaturalnessRewrite(draft: string, o: RewriteOptions, model: RewriteModel): Promise<RewriteResult> {
  const before = analyzeSection(draft, o);
  const res: RewriteResult = { text: draft, changed: false, attempts: [], proposals: [], before, after: before, unresolved: unresolvedOf(before) };
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
    const { text: cand, applied, rejected } = applyEdits(best, edits, o.knownNames);
    res.proposals!.push({ attempt: i, rawEdits: edits, rejectedEdits: rejected, candidate: cand, changeRatio: charChangeRatio(draft, cand) });
    const push = (accepted: boolean, reason: string, scoreAfter?: number) => res.attempts.push({ attempt: i, edits: applied, accepted, reason, scoreBefore, scoreAfter });
    if (!applied) { push(false, "no_safe_edits"); continue; }
    if (charChangeRatio(draft, cand) > limit) { push(false, "change_too_broad"); continue; }
    if (det(cand) > baseDet) { push(false, "introduced_validation_issue"); continue; }
    const after = analyzeSection(cand, o); const scoreAfter = naturalnessScore(after);
    // Whole-section checks: a new repeated sentence shape means the pattern only moved.
    const oldT = new Set(templatesOf(bestFindings).map((t) => t.template));
    if (templatesOf(after).some((t) => !oldT.has(t.template))) { push(false, "pattern_substituted", scoreAfter); continue; }
    const cvB = rhythmStats(best).cv, cvA = rhythmStats(cand).cv;
    if (cvB > 0 && cvA < cvB * 0.85) { push(false, "rhythm_flattened", scoreAfter); continue; }
    if (localRepetition(cand) > localRepetition(best)) { push(false, "local_repetition", scoreAfter); continue; }
    const stockB = new Set(mech(bestFindings).stockPhrases ?? []);
    if ((mech(after).stockPhrases ?? []).some((p) => !stockB.has(p))) { push(false, "pattern_substituted", scoreAfter); continue; }
    if (scoreAfter >= scoreBefore) { push(false, "not_better", scoreAfter); continue; }
    push(true, "improved", scoreAfter);
    best = cand; bestFindings = after;
  }
  return { ...res, text: best, changed: best !== draft, after: bestFindings, unresolved: unresolvedOf(bestFindings) };
}

/** Sentences that repeat one word pair 3+ times — a fix that crams repetition into one line. */
function localRepetition(text: string): number {
  return (text.match(/[^.!?]+[.!?]/g) ?? []).filter((s) => {
    const w = s.toLowerCase().match(/[a-z']+/g) ?? []; const c = new Map<string, number>();
    for (let i = 0; i + 1 < w.length; i++) { const k = w[i] + " " + w[i + 1]; c.set(k, (c.get(k) ?? 0) + 1); }
    return [...c.values()].some((n) => n >= 3);
  }).length;
}
type MechEv = { stockPhrases?: string[]; templates?: { template: string; count: number }[]; duplicates?: { sentences?: { text: string; count: number }[] } };
const mech = (fs: NaturalnessFinding[]) => (fs.find((f) => f.category === "mechanical_pattern")?.evidence ?? {}) as MechEv;
const templatesOf = (fs: NaturalnessFinding[]) => mech(fs).templates ?? [];
/** Targeted weaknesses still present — reported, never hidden behind a lower score. */
export function unresolvedOf(fs: NaturalnessFinding[]): string[] {
  const e = mech(fs);
  return [
    ...(e.stockPhrases ?? []).map((p) => `stock phrase: "${p}"`),
    ...(e.duplicates?.sentences ?? []).map((d) => `duplicate sentence ×${d.count}: "${d.text.slice(0, 80)}"`),
    ...(e.templates ?? []).map((t) => `repeated sentence shape ×${t.count}: ${t.template}`),
  ];
}

/** Author explicitly asked for a targeted rewrite of a held draft: runs the same bounded engine
 *  regardless of the book's automatic mode. Never accepts; caller saves a new candidate version. */
export function authorNaturalnessRewrite(draft: string, o: Omit<RewriteOptions, "mode">, model: RewriteModel): Promise<RewriteResult> {
  return runNaturalnessRewrite(draft, { ...o, mode: "analyze_and_rewrite" }, model);
}
