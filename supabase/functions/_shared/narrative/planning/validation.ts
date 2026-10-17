// Phase G — Unified Validation (pure). Shared by edge functions and tests.
// Rules: nothing here bans ordinary words globally; repetition is judged in context;
// only material canon/factual conflicts route to canon reconciliation; large rewrites
// need author approval; validation decides BEFORE acceptance and never touches accepted prose.

export type Severity = "info" | "warning" | "minor" | "moderate" | "material";
export type Category = "deterministic" | "plan_intent" | "continuity" | "epistemic" | "writing_quality";
export type Route = "none" | "auto_repair" | "editorial_review" | "author_approval" | "canon_reconciliation";
export type Adapter =
  | "fiction" | "childrens" | "narrative_nonfiction" | "practical" | "technical"
  | "business" | "modular" | "poetry" | "screenplay" | string;

export interface Finding {
  code: string; category: Category; severity: Severity; message: string;
  excerpt?: string; repairable: boolean;
  /** Material canon kinds only: fact, identity, timeline, canon. */
  canonKind?: "fact" | "identity" | "timeline" | "canon";
}

// ── 1. Configurable vocabulary (per book / genre / author) ────────────────────
export interface VocabularyRules { banned: string[]; allowed: string[] }

/** Restrictions come only from settings. No defaults — an empty config bans nothing. */
export function vocabularyRules(controls: unknown, genreBanned: string[] = []): VocabularyRules {
  const c = (controls ?? {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => String(x ?? "").trim().toLowerCase()).filter(Boolean);
  const allowed = list(c.allowedExpressions);
  const banned = [...new Set([...list(genreBanned), ...list(c.bannedExpressions), ...list(c.bannedWords)])].filter((w) => !allowed.includes(w));
  return { banned, allowed };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function findBannedExpressions(text: string, rules: VocabularyRules): Finding[] {
  const out: Finding[] = [];
  for (const w of rules.banned) {
    const m = new RegExp(`(^|[^\\p{L}\\p{N}])(${esc(w)})(?=$|[^\\p{L}\\p{N}])`, "iu").exec(text);
    if (m) out.push({ code: "BANNED_EXPRESSION", category: "deterministic", severity: "minor", message: `Uses "${w}", which this book's settings exclude.`, excerpt: m[2], repairable: true });
  }
  return out;
}

/** Output hygiene that is never prose: planner labels and markdown markup. */
export function findOutputArtifacts(text: string): Finding[] {
  const out: Finding[] = [];
  if (/^\s*(?:Hook|Teaser|Beat|Note)\s*:/im.test(text) || /\[\/?(?:HOOK|TEASER|SCENE|BEAT|NOTE)\]/i.test(text))
    out.push({ code: "META_LABEL", category: "deterministic", severity: "minor", message: "Planning label left in prose.", repairable: true });
  if (/^\s{0,3}#{1,6}\s/m.test(text) || /\*\*[^*\n]+\*\*/.test(text))
    out.push({ code: "MARKDOWN", category: "deterministic", severity: "minor", message: "Markdown formatting in prose.", repairable: true });
  return out;
}

/**
 * Phase 3: a protected term appearing early is only a note — foreshadowing must stay possible.
 * Premature disclosure is judged semantically by the evaluator (see knowledge.ts parseEpistemic).
 */
export function findSecretLeaks(text: string, secrets: string[]): Finding[] {
  const t = text.toLowerCase();
  const hit = secrets.map((s) => s.trim()).filter((s) => s.length >= 4 && t.includes(s.toLowerCase()));
  return hit.length ? [{ code: "SECRET_TERM_PRESENT", category: "deterministic", severity: "minor", message: "A protected term appears before its reveal. Fine as foreshadowing; check it doesn't give the twist away.", excerpt: hit[0], repairable: false }] : [];
}

// ── 2. Contextual repetition ─────────────────────────────────────────────────
export interface RepetitionContext { adapter: Adapter; motifs?: string[]; terminology?: string[]; minWords?: number; minCount?: number }

const DIALOGUE = /["“”«»]/;
function isDialogueSpan(text: string, idx: number): boolean {
  const lineStart = text.lastIndexOf("\n", idx) + 1;
  const lineEnd = text.indexOf("\n", idx); const line = text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
  const before = text.slice(lineStart, idx); const quotes = (before.match(/["“”]/g) ?? []).length;
  return DIALOGUE.test(line) && quotes % 2 === 1;
}

/**
 * Flags only unintended repetition: narration phrases repeated ≥ minCount times that are
 * not dialogue, a declared motif/refrain, exact terminology, or a refrain in children's/poetry.
 */
export function findRepetition(text: string, ctx: RepetitionContext): Finding[] {
  if (ctx.adapter === "childrens" || ctx.adapter === "poetry") return [];
  const n = ctx.minWords ?? 5; const min = ctx.minCount ?? 3;
  const protectedPhrases = [...(ctx.motifs ?? []), ...(ctx.terminology ?? [])].map((s) => s.toLowerCase().trim()).filter(Boolean);
  const words: { w: string; i: number }[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}'’]+/gu)) words.push({ w: m[0].toLowerCase(), i: m.index ?? 0 });
  const seen = new Map<string, number[]>();
  for (let k = 0; k + n <= words.length; k++) {
    const key = words.slice(k, k + n).map((x) => x.w).join(" ");
    const arr = seen.get(key) ?? []; arr.push(words[k].i); seen.set(key, arr);
  }
  const out: Finding[] = []; const reported: string[] = [];
  for (const [phrase, idxs] of seen) {
    if (protectedPhrases.some((p) => phrase.includes(p) || p.includes(phrase))) continue;
    const narration = idxs.filter((i) => !isDialogueSpan(text, i));
    if (narration.length < min) continue;
    if (reported.some((r) => r.includes(phrase.split(" ").slice(1).join(" ")))) continue;
    reported.push(phrase);
    out.push({ code: "UNINTENDED_REPETITION", category: "writing_quality", severity: "minor", message: `Narration repeats "${phrase}" ${narration.length} times.`, excerpt: phrase, repairable: true });
  }
  return out;
}

// ── 3. Plan intent: deferrals are not omissions ──────────────────────────────
export type BeatIntent = "immediate_payoff" | "ongoing_arc" | "setup_only" | "deferred_resolution";
export interface BeatCheck { id: string; intent: BeatIntent; planted: boolean; resolved: boolean; required?: boolean; explanationRevealed?: boolean }

export function classifyBeats(beats: BeatCheck[]): Finding[] {
  const out: Finding[] = [];
  for (const b of beats) {
    if (b.intent === "setup_only" || b.intent === "deferred_resolution") {
      if (!b.planted) out.push({ code: "SETUP_NOT_PLANTED", category: "plan_intent", severity: "moderate", message: `Setup for ${b.id} was not planted.`, repairable: true });
      else if (b.explanationRevealed) out.push({ code: "DEFERRAL_RESOLVED_EARLY", category: "plan_intent", severity: "material", canonKind: "canon", message: `${b.id} was explained before its planned payoff.`, repairable: true });
      continue; // unresolved is the correct outcome
    }
    if (b.intent === "ongoing_arc") { if (!b.planted) out.push({ code: "ARC_NOT_ADVANCED", category: "plan_intent", severity: "minor", message: `${b.id} did not advance.`, repairable: true }); continue; }
    if (!b.resolved) out.push({ code: "OBJECTIVE_MISSING", category: "plan_intent", severity: b.required ? "moderate" : "minor", message: `Planned objective ${b.id} is missing.`, repairable: true });
  }
  return out;
}

// ── 4. Narrative nonfiction evidence tiers ───────────────────────────────────
export type EvidenceTier = "documented" | "recollection" | "uncertain" | "illustrative";
export interface Claim { id: string; tier: EvidenceTier; sourceProvided: boolean; presentedAsFact: boolean }

export function checkEvidence(claims: Claim[], adapter: Adapter): Finding[] {
  if (adapter !== "narrative_nonfiction") return [];
  const out: Finding[] = [];
  for (const c of claims) {
    if (c.tier === "documented" && !c.sourceProvided) out.push({ code: "UNSOURCED_DOCUMENTED", category: "epistemic", severity: "material", canonKind: "fact", message: `Claim ${c.id} is marked documented without a provided source.`, repairable: false });
    else if ((c.tier === "uncertain" || c.tier === "illustrative") && c.presentedAsFact) out.push({ code: "SPECULATION_AS_FACT", category: "epistemic", severity: "moderate", message: `Claim ${c.id} is presented as established fact.`, repairable: true });
  }
  return out;
}

// ── 5. Routing: canon vs editorial ───────────────────────────────────────────
export function routeFinding(f: Finding): Route {
  if (f.severity === "info" || f.severity === "warning") return "none";
  if (f.severity === "material" && f.canonKind) return "canon_reconciliation";
  if (f.repairable) return "auto_repair";
  return "editorial_review";
}

/** Findings that stop acceptance of THIS draft. Warnings and editorial notes never block. */
export const blocksAcceptance = (fs: Finding[]) => fs.some((f) => routeFinding(f) === "canon_reconciliation");

// ── 6. Revision scope: configurable warning, author approval above it ───────
export const DEFAULT_REVISION_WARN_RATIO = 0.2;

import { changeRatio } from "../../writers/textDiff.ts";
function paragraphs(t: string) { return t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean); }
/** Share of the original actually modified (word-level diff; unchanged text between edits never counts). */
export function revisionChangeRatio(original: string, revised: string): number {
  if (!paragraphs(original).length) return revised.trim() ? 1 : 0;
  return changeRatio(original, revised);
}

export interface RevisionDecision { apply: boolean; ratio: number; route: Route; reason: string }

/**
 * Automatic repairs only ever target a draft that has NOT entered canon. Accepted-and-extracted
 * prose is never overwritten automatically. Above the configured ratio the change is held for
 * explicit author approval instead of being forbidden.
 */
export function decideRevision(o: { original: string; revised: string; draftInCanon: boolean; warnRatio?: number; authorApproved?: boolean; regressions?: Finding[] }): RevisionDecision {
  const ratio = revisionChangeRatio(o.original, o.revised);
  if (o.draftInCanon) return { apply: false, ratio, route: "editorial_review", reason: "accepted_prose_protected" };
  if ((o.regressions ?? []).some((f) => f.severity === "material" || f.severity === "moderate"))
    return { apply: false, ratio, route: "editorial_review", reason: "revision_introduced_regression" };
  const warn = o.warnRatio ?? DEFAULT_REVISION_WARN_RATIO;
  if (ratio > warn && !o.authorApproved) return { apply: false, ratio, route: "author_approval", reason: "broad_rewrite_needs_approval" };
  return { apply: true, ratio, route: "none", reason: ratio > warn ? "approved_broad_rewrite" : "targeted_revision" };
}

// ── 7. Bounded loop with re-validation ───────────────────────────────────────
export const MAX_REVISION_ROUNDS = 2;
export interface LoopResult { text: string; rounds: number; remaining: Finding[]; heldForApproval?: { text: string; ratio: number }; outcome: "clean" | "repaired" | "escalated" }

export async function runValidationLoop(
  draft: string,
  validate: (t: string) => Finding[] | Promise<Finding[]>,
  revise: (t: string, targets: Finding[]) => Promise<string>,
  opts: { warnRatio?: number } = {},
): Promise<LoopResult> {
  let text = draft; let findings = await validate(text); let rounds = 0;
  while (rounds < MAX_REVISION_ROUNDS) {
    const targets = findings.filter((f) => routeFinding(f) === "auto_repair" || (routeFinding(f) === "canon_reconciliation" && f.repairable));
    if (!targets.length) break;
    rounds++;
    const candidate = await revise(text, targets);
    const after = await validate(candidate);
    const before = new Set(findings.map((f) => f.code));
    const regressions = after.filter((f) => !before.has(f.code));
    const d = decideRevision({ original: text, revised: candidate, draftInCanon: false, warnRatio: opts.warnRatio, regressions });
    if (d.route === "author_approval") return { text, rounds, remaining: findings, heldForApproval: { text: candidate, ratio: d.ratio }, outcome: "escalated" };
    if (!d.apply) break; // discard regressing revision, keep best prior draft
    text = candidate; findings = after;
  }
  const open = findings.filter((f) => routeFinding(f) !== "none");
  return { text, rounds, remaining: open, outcome: open.length ? "escalated" : rounds ? "repaired" : "clean" };
}

/** Free deterministic pass run before a progressive section is accepted. */
export function deterministicValidation(text: string, o: { controls?: unknown; secrets?: string[]; adapter?: Adapter; motifs?: string[]; terminology?: string[] }): Finding[] {
  return [
    ...findOutputArtifacts(text),
    ...findBannedExpressions(text, vocabularyRules(o.controls)),
    ...findSecretLeaks(text, o.secrets ?? []),
    ...findRepetition(text, { adapter: o.adapter ?? "fiction", motifs: o.motifs, terminology: o.terminology }),
  ];
}
