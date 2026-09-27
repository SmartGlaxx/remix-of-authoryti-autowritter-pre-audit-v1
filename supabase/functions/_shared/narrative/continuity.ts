// Pass 4 — Continuity checker + automated revision. Pure logic (no I/O): prompts,
// strict output validation, classification, revision safety and the bounded loop.
// Shared by the edge function and tests. Candidate/intermediate drafts never touch
// narrative state: extraction runs only after the loop returns a final text.
import { AUTHORITY_RANK, normText, type Authority } from "./rules.ts";

export const ISSUE_TYPES = [
  "FACT_CONTRADICTION", "CHARACTER_STATE_CONTRADICTION", "CHARACTER_KNOWLEDGE_CONTRADICTION",
  "LOCATION_CONTRADICTION", "RELATIONSHIP_CONTRADICTION", "INVENTORY_CONTRADICTION",
  "TIMELINE_CONTRADICTION", "EVENT_CAUSALITY_CONTRADICTION", "PLOT_THREAD_CONTRADICTION",
  "CANON_CONFLICT", "TERMINOLOGY_INCONSISTENCY", "NUMERICAL_INCONSISTENCY", "CLAIM_CONTRADICTION",
  "OTHER_CONTINUITY_ISSUE",
] as const;
export type IssueType = typeof ISSUE_TYPES[number];
export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
/** ERROR = substantiated contradiction; AMBIGUOUS = needs a human; the other two are never issues. */
export type Classification = "ERROR" | "AMBIGUOUS" | "LEGITIMATE_CHANGE" | "INSUFFICIENT_INFO";

export interface ContinuityIssue {
  type: IssueType;
  classification: Classification;
  severity: Severity;
  confidence: number;
  excerpt: string;              // verbatim from the section
  conflictingEvidence: string;  // established fact/state/event it contradicts
  sourceChapter: number | null; // 1-based as shown in the state block, null if unknown
  sourceSubsection: number | null;
  entity: string | null;
  authority: Authority | null;  // authority of the conflicting evidence
  explanation: string;
  repairable: boolean;
  suggestedResolution: string;
}

export type CheckStatus = "PASSED" | "PASSED_WITH_WARNINGS" | "REVISED" | "NEEDS_REVIEW" | "CHECK_FAILED";

/** Material = a substantiated error worth acting on. Low severity / low confidence never triggers revision. */
export const MATERIAL_MIN_CONFIDENCE = 0.6;
export const MAX_REVISION_CYCLES = 3;
export const MAX_SECTION_CHARS = 60_000;

// Detection (evidence + classification + severity) is separate from repair eligibility.
// HIGH/CRITICAL errors are always material regardless of confidence; confidence only
// gates MEDIUM issues and automatic repair.
export const isMaterial = (i: ContinuityIssue) =>
  i.classification === "ERROR" && (
    SEVERITY_RANK[i.severity] >= SEVERITY_RANK.HIGH ||
    (SEVERITY_RANK[i.severity] >= SEVERITY_RANK.MEDIUM && i.confidence >= MATERIAL_MIN_CONFIDENCE)
  );

/** Repair eligibility: material + repairable + confident enough to edit automatically. */
export const isAutoRepairable = (i: ContinuityIssue) =>
  isMaterial(i) && i.repairable && i.confidence >= MATERIAL_MIN_CONFIDENCE;

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export function isNonfiction(bookType: string | null | undefined): boolean {
  return ["self_help", "business", "nonfiction", "non_fiction", "educational", "memoir_guide", "how_to"].includes(String(bookType ?? "").toLowerCase());
}

export function buildCheckerPrompt(opts: { stateText: string; sectionText: string; nonfiction: boolean; chapterNumber: number; subsectionNumber: number }): { system: string; user: string } {
  const scope = opts.nonfiction
    ? `This is NONFICTION. Check internal consistency only: definitions, terminology, numerical claims, frameworks, repeated claims and advice that contradict earlier sections. Do NOT fact-check against the outside world.`
    : `This is FICTION. Check facts, character physical/emotional state, what each character KNOWS (per character, not global), locations and travel, relationships, inventory, timeline (use the story timeline, not chapter order — flashbacks are legitimate), event causality, and plot threads (resolved threads stay resolved; unrevealed clues stay unknown; abandoned/superseded threads stay so unless deliberately reactivated).`;
  const system = `You are a strict continuity checker for a book manuscript. You compare ONE new section against the ESTABLISHED STORY STATE (everything that was true strictly before this section).

${scope}

Authority of established evidence (highest first): USER_CANON > OUTLINE_CANON > APPROVED_GENERATED_STATE > AI_INFERENCE. Disputed facts are NOT canon — never report a contradiction against a disputed fact alone.

Classify every candidate finding:
- ERROR: a substantiated contradiction with established evidence and no in-text transition or explanation.
- AMBIGUOUS: may conflict, but a reasonable reader could reconcile it; needs a human.
- LEGITIMATE_CHANGE: a state change the section itself explains (e.g. calmed down, travelled, learned something on-page). Do not report.
- INSUFFICIENT_INFO: the established state says nothing either way. Do not report.
Never label uncertainty as an ERROR. Style, prose quality, pacing and editorial preferences are OUT OF SCOPE — never report them.

Return ONLY JSON: {"issues":[{"type":one of ${ISSUE_TYPES.join("|")},"classification":"ERROR"|"AMBIGUOUS","severity":"CRITICAL"|"HIGH"|"MEDIUM"|"LOW","confidence":0..1,"excerpt":"exact verbatim quote from the NEW SECTION","conflictingEvidence":"the established fact/state/event, quoted or paraphrased from the STATE","sourceChapter":number|null,"sourceSubsection":number|null,"entity":string|null,"authority":"USER_CANON"|"OUTLINE_CANON"|"APPROVED_GENERATED_STATE"|"AI_INFERENCE"|null,"explanation":"why they conflict","repairable":true|false,"suggestedResolution":"minimal change to the new section"}]}
Return {"issues":[]} when there are no ERROR or AMBIGUOUS findings.`;
  const user = `ESTABLISHED STORY STATE (before Chapter ${opts.chapterNumber}, Section ${opts.subsectionNumber}):
${opts.stateText.trim() || "(nothing established yet)"}

NEW SECTION (Chapter ${opts.chapterNumber}, Section ${opts.subsectionNumber}):
"""
${opts.sectionText.slice(0, MAX_SECTION_CHARS)}
"""`;
  return { system, user };
}

export function buildRevisionPrompt(opts: { sectionText: string; issues: ContinuityIssue[]; stateText: string; nonfiction: boolean }): { system: string; user: string } {
  const system = `You repair continuity errors in one ${opts.nonfiction ? "nonfiction" : "fiction"} section with MINIMAL edits.
Rules:
- Change only the sentences needed to remove the listed contradictions so the section agrees with the established evidence.
- Preserve everything else verbatim: intent, voice, POV, tense, tone, style, pacing, scene objective, paragraph breaks and length.
- Do NOT invent new facts, backstory or explanations to justify a contradiction. Prefer aligning the section with canon.
- Never change established canon; the section must yield to it.
- No markdown, no headings, no labels, no commentary. Output ONLY the full revised section text.`;
  const list = opts.issues.map((i, n) =>
    `${n + 1}. [${i.type}, ${i.severity}] Problem text: "${i.excerpt}"\n   Established: ${i.conflictingEvidence}${i.authority ? ` (${i.authority})` : ""}\n   Why: ${i.explanation}\n   Suggested fix: ${i.suggestedResolution}`).join("\n");
  const user = `ESTABLISHED STORY STATE:
${opts.stateText.trim() || "(none)"}

CONTINUITY ERRORS TO FIX:
${list}

SECTION TO REVISE:
"""
${opts.sectionText}
"""`;
  return { system, user };
}

// ---------------------------------------------------------------------------
// Validation of model output — nothing unverifiable becomes an issue
// ---------------------------------------------------------------------------

const clamp01 = (n: unknown) => { const x = Number(n); return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0; };
const str = (v: unknown, max = 1000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const intOrNull = (v: unknown) => (Number.isInteger(v) ? (v as number) : null);
const quoteNorm = (s: string) => normText(s.replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'").replace(/[.…,;:!?"']+$/g, "").replace(/^["']+/, ""));

/** The excerpt must genuinely appear in the section (whitespace/quote-insensitive). */
export function excerptInSection(excerpt: string, section: string): boolean {
  const e = quoteNorm(excerpt);
  if (e.length < 8) return false;
  return quoteNorm(section).includes(e);
}

export function parseJsonLoose(raw: string): unknown {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(t); } catch { /* fallthrough */ }
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1));
  throw new Error("Checker returned no JSON");
}

export interface ParsedCheck { issues: ContinuityIssue[]; dropped: { reason: string; excerpt: string }[] }

/**
 * Validates checker output. Throws on unparseable output (→ CHECK_FAILED, never "clean").
 * Drops: non-issues, missing evidence, excerpts not present in the section, and
 * contradictions whose only evidence is a disputed (non-canonical) fact.
 */
export function parseCheckerOutput(raw: string, sectionText: string): ParsedCheck {
  const data = parseJsonLoose(raw) as { issues?: unknown };
  if (!data || typeof data !== "object" || !Array.isArray(data.issues)) throw new Error("Checker output missing issues array");
  const issues: ContinuityIssue[] = [];
  const dropped: ParsedCheck["dropped"] = [];
  for (const r of data.issues as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const classification = r.classification as Classification;
    const excerpt = str(r.excerpt, 600);
    if (classification !== "ERROR" && classification !== "AMBIGUOUS") { dropped.push({ reason: "not_an_issue", excerpt }); continue; }
    const conflictingEvidence = str(r.conflictingEvidence, 800);
    if (!conflictingEvidence) { dropped.push({ reason: "no_evidence", excerpt }); continue; }
    if (!excerptInSection(excerpt, sectionText)) { dropped.push({ reason: "excerpt_not_in_section", excerpt }); continue; }
    if (/\bdisputed\b/i.test(conflictingEvidence) && !/\b(USER_CANON|OUTLINE_CANON)\b/.test(conflictingEvidence)) { dropped.push({ reason: "disputed_fact_only", excerpt }); continue; }
    const type = (ISSUE_TYPES as readonly string[]).includes(r.type as string) ? (r.type as IssueType) : "OTHER_CONTINUITY_ISSUE";
    const severity = (["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).includes(r.severity as Severity) ? (r.severity as Severity) : "MEDIUM";
    const authority = (Object.keys(AUTHORITY_RANK) as Authority[]).includes(r.authority as Authority) ? (r.authority as Authority) : null;
    issues.push({
      type, classification, severity, confidence: clamp01(r.confidence), excerpt, conflictingEvidence,
      sourceChapter: intOrNull(r.sourceChapter), sourceSubsection: intOrNull(r.sourceSubsection),
      entity: str(r.entity, 200) || null, authority, explanation: str(r.explanation, 800),
      // Ambiguities are never auto-repaired; a human decides.
      repairable: classification === "ERROR" && r.repairable !== false,
      suggestedResolution: str(r.suggestedResolution, 800),
    });
  }
  return { issues, dropped };
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export function maxSeverity(issues: ContinuityIssue[]): Severity | null {
  let best: Severity | null = null;
  for (const i of issues) if (!best || SEVERITY_RANK[i.severity] > SEVERITY_RANK[best]) best = i.severity;
  return best;
}

/** Weighted badness; used to keep the best version across revision cycles. */
export function issueScore(issues: ContinuityIssue[]): number {
  return issues.filter(isMaterial).reduce((s, i) => s + SEVERITY_RANK[i.severity] * 10 + i.confidence, 0);
}

export type Decision =
  | { kind: "accept"; status: "PASSED" | "PASSED_WITH_WARNINGS" }
  | { kind: "revise"; targets: ContinuityIssue[] }
  | { kind: "review"; reason: string };

export function decide(issues: ContinuityIssue[]): Decision {
  const material = issues.filter(isMaterial);
  if (material.length === 0) {
    const needsHuman = issues.some((i) => i.classification === "AMBIGUOUS" && SEVERITY_RANK[i.severity] >= SEVERITY_RANK.HIGH);
    if (needsHuman) return { kind: "review", reason: "High-severity ambiguity needs human review" };
    return { kind: "accept", status: issues.length ? "PASSED_WITH_WARNINGS" : "PASSED" };
  }
  const unrepairable = material.filter((i) => !isAutoRepairable(i));
  if (unrepairable.length) return { kind: "review", reason: `${unrepairable.length} material issue(s) not safely auto-repairable (unrepairable or low confidence)` };
  return { kind: "revise", targets: material };
}

/** Rejects revisions that are empty, contain markup/commentary, or drift far from the original. */
export function validateRevision(original: string, revised: string): { ok: true; text: string } | { ok: false; reason: string } {
  let t = revised.trim().replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
  t = t.replace(/^"""\s*/, "").replace(/\s*"""$/, "").trim();
  if (!t) return { ok: false, reason: "empty_revision" };
  if (/^#{1,6}\s|^\s*(revised section|here is|here's)\b/im.test(t)) return { ok: false, reason: "revision_contains_commentary" };
  const ratio = t.length / Math.max(1, original.trim().length);
  if (ratio < 0.6 || ratio > 1.5) return { ok: false, reason: `revision_length_drift_${ratio.toFixed(2)}` };
  // Minimal-edit guard: most original sentences must survive verbatim. Short sections
  // (<8 long sentences) are protected by the length-ratio check only, because fixing one
  // contradiction legitimately touches a large share of a handful of sentences.
  const sentences = original.split(/(?<=[.!?])\s+/).map((s) => normText(s)).filter((s) => s.length > 25);
  if (sentences.length >= 8) {
    const nt = normText(t);
    const kept = sentences.filter((s) => nt.includes(s)).length / sentences.length;
    if (kept < 0.4) return { ok: false, reason: `revision_not_minimal_${kept.toFixed(2)}` };
  }
  return { ok: true, text: t };
}

// ---------------------------------------------------------------------------
// Bounded loop
// ---------------------------------------------------------------------------

export interface LoopDeps {
  check(text: string): Promise<ContinuityIssue[]>;
  revise(text: string, targets: ContinuityIssue[]): Promise<string>;
}

export interface LoopAttempt {
  cycle: number; // 0 = original draft
  issues: ContinuityIssue[];
  decision: Decision["kind"] | "check_failed" | "revision_rejected" | "revision_failed";
  note?: string;
}

export interface LoopResult {
  status: CheckStatus;
  finalText: string;
  revised: boolean;
  revisionCount: number;
  issues: ContinuityIssue[];   // material/unresolved on the final text
  warnings: ContinuityIssue[]; // non-material observations on the final text
  attempts: LoopAttempt[];
  error: string | null;
}

const split = (issues: ContinuityIssue[]) => ({ issues: issues.filter(isMaterial), warnings: issues.filter((i) => !isMaterial(i)) });

/**
 * generate → check → classify → (revise → re-check) ×≤maxCycles.
 * Checker failure → CHECK_FAILED with the text preserved (never reported clean).
 * Reviser failure/unsafe revision → best version kept, NEEDS_REVIEW.
 */
export const REVISION_TIME_BUDGET_MS = 100_000;

export async function runContinuityLoop(
  original: string, deps: LoopDeps, maxCycles = MAX_REVISION_CYCLES,
  opts: { budgetMs?: number; now?: () => number } = {},
): Promise<LoopResult> {
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.budgetMs ?? REVISION_TIME_BUDGET_MS);
  const attempts: LoopAttempt[] = [];
  let current = original;
  let currentIssues: ContinuityIssue[];
  try { currentIssues = await deps.check(current); }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    attempts.push({ cycle: 0, issues: [], decision: "check_failed", note: msg });
    return { status: "CHECK_FAILED", finalText: original, revised: false, revisionCount: 0, issues: [], warnings: [], attempts, error: msg };
  }
  let best = { text: current, issues: currentIssues, score: issueScore(currentIssues) };
  let revisions = 0;

  for (let cycle = 0; ; cycle++) {
    const d = decide(currentIssues);
    attempts.push({ cycle, issues: currentIssues, decision: d.kind, note: d.kind === "review" ? d.reason : undefined });
    if (d.kind === "accept") {
      return { status: revisions > 0 ? "REVISED" : d.status, finalText: current, revised: revisions > 0, revisionCount: revisions, ...split(currentIssues), attempts, error: null };
    }
    const outOfTime = d.kind !== "review" && revisions < maxCycles && now() >= deadline;
    if (d.kind === "review" || revisions >= maxCycles || outOfTime) {
      if (outOfTime) attempts[attempts.length - 1].note = "Revision time budget exhausted";
      else if (d.kind !== "review") attempts[attempts.length - 1].note = `Revision limit (${maxCycles}) reached`;
      return { status: "NEEDS_REVIEW", finalText: best.text, revised: best.text !== original, revisionCount: revisions, ...split(best.issues), attempts, error: null };
    }
    // revise
    let candidate: string;
    try { candidate = await deps.revise(current, d.targets); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      attempts.push({ cycle: cycle + 1, issues: [], decision: "revision_failed", note: msg });
      return { status: "NEEDS_REVIEW", finalText: best.text, revised: best.text !== original, revisionCount: revisions, ...split(best.issues), attempts, error: msg };
    }
    revisions++;
    const v = validateRevision(original, candidate);
    if (v.ok === false) {
      attempts.push({ cycle: cycle + 1, issues: [], decision: "revision_rejected", note: v.reason });
      if (revisions >= maxCycles) return { status: "NEEDS_REVIEW", finalText: best.text, revised: best.text !== original, revisionCount: revisions, ...split(best.issues), attempts, error: null };
      continue; // retry revising the same current text
    }
    let nextIssues: ContinuityIssue[];
    try { nextIssues = await deps.check(v.text); }
    catch (e) {
      // Re-check failed: the revision is unverified, so keep the best verified version.
      const msg = e instanceof Error ? e.message : String(e);
      attempts.push({ cycle: cycle + 1, issues: [], decision: "check_failed", note: msg });
      return { status: "NEEDS_REVIEW", finalText: best.text, revised: best.text !== original, revisionCount: revisions, ...split(best.issues), attempts, error: msg };
    }
    current = v.text;
    currentIssues = nextIssues;
    const score = issueScore(nextIssues);
    if (score < best.score) best = { text: current, issues: nextIssues, score };
  }
}

export function resolutionFor(status: CheckStatus): "auto_resolved" | "none_needed" | "needs_review" | "failed" {
  return status === "REVISED" ? "auto_resolved" : status === "NEEDS_REVIEW" ? "needs_review" : status === "CHECK_FAILED" ? "failed" : "none_needed";
}
