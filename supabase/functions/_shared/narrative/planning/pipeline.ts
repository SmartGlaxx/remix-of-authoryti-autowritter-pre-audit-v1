// Phase F: controlled progressive pipeline (pure, no I/O). Opt-in per book via
// books.controls.planning_pipeline = "progressive"; anything else = current writing, unchanged.
// Shared by generate-content, check-continuity, extract-narrative-state and tests.
import type { MasterPlanSkeleton, PlannedReveal } from "./engine.ts";
import { generationGate, type PriorSection } from "./lifecycle.ts";
import { blockingDiscrepancies } from "./reconciliationFilter.ts";
import { containsVerbatim, type AnchorMatchMode } from "./safeguards.ts";
import type { ResolvedPlan } from "./planningContext.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export type Pipeline = "progressive" | "current";
export const resolvePipeline = (controls: unknown): Pipeline =>
  (controls as Row | null)?.planning_pipeline === "progressive" ? "progressive" : "current";

// ---------- Spoiler-safe, actionable foreshadowing ----------
/**
 * Four knowledge layers: the planner knows the secret (summary/secretTerms); the writer gets
 * `writerInstruction` (concrete on-page behaviour); `viewpointKnows` / `readerSees` say what the
 * scene may make visible. Writers never receive the summary or secret terms.
 */
export interface SetupDirective { chapterIndex: number; writerInstruction: string; viewpointKnows?: string; readerSees?: string }
export type RevealWithSetup = PlannedReveal & { secretTerms?: string[]; setupDirectives?: SetupDirective[] };

export interface ForeshadowItem { revealId: string; text: string; specific: boolean }

const secretsOf = (r: RevealWithSetup) => [r.summary, ...(r.secretTerms ?? [])].map((s) => s?.trim().toLowerCase()).filter(Boolean) as string[];
const leaks = (t: string, secrets: string[]) => { const l = t.toLowerCase(); return secrets.some((s) => l.includes(s)); };

/** Setup instructions for this chapter. A directive that would leak its own secret is dropped (falls back, flagged). */
export function foreshadowFor(master: MasterPlanSkeleton, ch: number): ForeshadowItem[] {
  const out: ForeshadowItem[] = [];
  const allFutureSecrets = (master.reveals as RevealWithSetup[]).filter((r) => r.revealChapter > ch).flatMap(secretsOf);
  for (const r of master.reveals as RevealWithSetup[]) {
    if (r.revealChapter <= ch) continue;
    const dirs = (r.setupDirectives ?? []).filter((d) => d.chapterIndex === ch && d.writerInstruction?.trim() && !leaks(`${d.writerInstruction} ${d.viewpointKnows ?? ""} ${d.readerSees ?? ""}`, allFutureSecrets));
    if (dirs.length) {
      for (const d of dirs) out.push({ revealId: r.id, specific: true, text:
        `Show on the page: ${d.writerInstruction.trim()}` +
        (d.viewpointKnows ? ` Viewpoint character understands only: ${d.viewpointKnows.trim()}` : "") +
        (d.readerSees ? ` Reader should notice: ${d.readerSees.trim()}` : "") +
        " Do not explain its significance." });
    } else if (r.setupChapters.includes(ch)) {
      out.push({ revealId: r.id, specific: false, text: "Plant one subtle, concrete setup detail for a later development; do not explain or resolve it." });
    }
  }
  return out;
}

// ---------- Exact-detail enforcement ----------
export interface AnchorRow { anchor_key: string; exact_text: string; match_mode: AnchorMatchMode; effective_chapter_index: number; version: number; is_active: boolean; context_hint?: string; retrieval_tags?: string[] }

/** Latest active in-scope version per key. */
export function scopedAnchors(rows: AnchorRow[], ch: number): AnchorRow[] {
  const m = new Map<string, AnchorRow>();
  for (const a of rows) {
    if (!a?.is_active || a.match_mode === "NONE" || a.effective_chapter_index > ch) continue;
    const p = m.get(a.anchor_key);
    if (!p || a.version > p.version) m.set(a.anchor_key, a);
  }
  return [...m.values()];
}

/**
 * Only anchors this section must reproduce: keys the approved section plan lists in
 * `requiredAnchors`, plus anchors tagged `always` (e.g. a user-fixed name spelling).
 * Stored anchors that the section doesn't need are never forced in.
 */
export function requiredAnchorKeys(section: Row | null | undefined, anchors: AnchorRow[]): string[] {
  const keys = new Set<string>(Array.isArray(section?.requiredAnchors) ? section!.requiredAnchors.map(String) : []);
  for (const a of anchors) if (a.retrieval_tags?.includes("always")) keys.add(a.anchor_key);
  return [...keys];
}

export interface AnchorViolation { key: string; expected: string; kind: "missing" | "variant" }

/**
 * Missing = required anchor not present verbatim. Variant = a near-miss form appears
 * (case/spacing/punctuation differs), which is a wrong reproduction, not an omission.
 */
export function checkAnchors(prose: string, anchors: AnchorRow[], required: string[]): AnchorViolation[] {
  const want = new Set(required);
  const loose = (s: string) => s.toLowerCase().replace(/[\s\-–—.,:;'"]/g, "");
  const flat = loose(prose);
  return anchors.filter((a) => want.has(a.anchor_key) && !containsVerbatim(prose, a.exact_text, a.match_mode))
    .map((a) => ({ key: a.anchor_key, expected: a.exact_text, kind: flat.includes(loose(a.exact_text)) ? "variant" as const : "missing" as const }));
}

export const MAX_ANCHOR_REPAIRS = 2;

export function buildAnchorRepairPrompt(text: string, v: AnchorViolation[]): { system: string; user: string } {
  return {
    system: "You correct exact details in one book section with the smallest possible edit. Change only the sentences needed so each listed detail appears exactly as given (verbatim, same spelling, digits and punctuation). If a detail is missing, add it in one natural sentence where it fits. Keep everything else verbatim: voice, tense, events, paragraph breaks, length. No markdown, no commentary. Output ONLY the full section.",
    user: `REQUIRED EXACT DETAILS:\n${v.map((x) => `- ${x.key}: "${x.expected}" (${x.kind === "variant" ? "appears in a wrong form" : "missing"})`).join("\n")}\n\nSECTION:\n"""\n${text}\n"""`,
  };
}

/** Bounded targeted repair. A repair that changes too much of the text is rejected (keeps the previous text). */
export async function runAnchorRepair(text: string, anchors: AnchorRow[], required: string[], repair: (t: string, v: AnchorViolation[]) => Promise<string>):
  Promise<{ text: string; repaired: boolean; attempts: number; remaining: AnchorViolation[] }> {
  let cur = text; let v = checkAnchors(cur, anchors, required); let attempts = 0;
  while (v.length && attempts < MAX_ANCHOR_REPAIRS) {
    attempts++;
    const next = (await repair(cur, v)).trim();
    if (!next || Math.abs(next.length - cur.length) > Math.max(400, cur.length * 0.15)) continue; // over-rewrite: discard
    const nv = checkAnchors(next, anchors, required);
    if (nv.length <= v.length) { cur = next; v = nv; }
  }
  return { text: cur, repaired: cur !== text, attempts, remaining: v };
}

// ---------- Generation gate ----------
export type GateResult = { ok: true } | { ok: false; code: "AWAIT_ACCEPTANCE" | "RECOVER_EXTRACTION" | "CANON_RECONCILIATION_REQUIRED"; reason: string };

/** Previous section must be accepted + extracted; real undecided serious contradictions block. */
export function progressiveGate(prior: PriorSection | null, logs: Row[], position: { chapterIndex: number; subsectionIndex: number }): GateResult {
  const g = generationGate(prior);
  if (!g.ok) return { ok: false, code: g.action === "await_acceptance" ? "AWAIT_ACCEPTANCE" : "RECOVER_EXTRACTION", reason: g.reason };
  const pos = (c: number, s: number) => c * 1000 + s;
  const here = pos(position.chapterIndex, position.subsectionIndex);
  const blocking = blockingDiscrepancies(logs as never).filter((l: Row) => pos(Number(l.chapter_index ?? l.chapterIndex ?? 0), Number(l.subsection_index ?? l.subsectionIndex ?? 0)) < here);
  if (blocking.length) return { ok: false, code: "CANON_RECONCILIATION_REQUIRED", reason: `${blocking.length} unresolved serious contradiction(s) need your decision` };
  return { ok: true };
}

// ---------- Progressive mode never silently downgrades ----------
/** Progressive books require a usable approved plan; legacy books never reach this check. */
export function requireApprovedPlan(plan: { usable: boolean; reason?: string }): { ok: true } | { ok: false; code: "PLAN_REQUIRED"; reason: string } {
  if (plan.usable) return { ok: true };
  return { ok: false, code: "PLAN_REQUIRED", reason: `Progressive Planning is on for this book, but no usable approved plan covers this section (${plan.reason ?? "unknown"}). Approve a plan or switch the book back to standard writing.` };
}

// ---------- Lease heartbeat ----------
export const LEASE_TTL_SECONDS = 120;
export const LEASE_HEARTBEAT_MS = 30_000;
export interface Heartbeat { lost(): boolean; stop(): void; beat(): Promise<boolean> }
/**
 * Renews the lease while work is active. One failed renewal (stale, expired, superseded or
 * error) marks the worker as lost for good; a lost worker must not commit.
 */
export function createLeaseHeartbeat(renew: () => Promise<boolean>, opts: { intervalMs?: number; setInterval?: typeof setInterval; clearInterval?: typeof clearInterval; onLost?: () => void } = {}): Heartbeat {
  let lost = false; let stopped = false;
  const si = opts.setInterval ?? setInterval, ci = opts.clearInterval ?? clearInterval;
  const beat = async () => {
    if (lost || stopped) return !lost;
    let ok = false;
    try { ok = await renew(); } catch { ok = false; }
    if (!ok && !stopped) { lost = true; opts.onLost?.(); ci(id); }
    return !lost;
  };
  const id = si(() => { void beat(); }, opts.intervalMs ?? LEASE_HEARTBEAT_MS);
  return { lost: () => lost, stop: () => { stopped = true; ci(id); }, beat };
}

// ---------- Extraction outcome → staged acceptance ----------
/** null = leave the acceptance untouched (it stays PENDING and keeps blocking the next section). */
export function extractionStatusFor(outcome: { status: string; reason?: string } | null): "EXTRACTED" | "FAILED" | null {
  if (!outcome) return "FAILED";
  if (outcome.status === "completed") return "EXTRACTED";
  if (outcome.status === "skipped" && outcome.reason === "already_processed") return "EXTRACTED";
  if (outcome.status === "failed") return "FAILED";
  return null;
}


/** The section just before (ch, sub) in the outline; null for the very first section. */
export function previousPosition(outline: Row | null | undefined, ch: number, sub: number): { chapterIndex: number; subsectionIndex: number } | null {
  if (sub > 0) return { chapterIndex: ch, subsectionIndex: sub - 1 };
  for (let c = ch - 1; c >= 0; c--) {
    const n = outline?.chapters?.[c]?.subsections?.length ?? 0;
    if (n > 0) return { chapterIndex: c, subsectionIndex: n - 1 };
  }
  return null;
}

/** Latest non-REVISED acceptance row → PriorSection (missing row = previous section never accepted). */
export function priorFromAcceptances(rows: Row[]): PriorSection | null | "missing" {
  const live = rows.filter((r) => r.manuscript_status !== "REVISED").sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
  if (!live.length) return "missing";
  return { manuscript: live[0].manuscript_status, extraction: live[0].extraction_status };
}

// ---------- Plan block for Standard mode ----------
/** Standard mode keeps its manuscript window; this adds only the writer-safe plan + exact details. */
export function renderPlanBlock(plan: ResolvedPlan, ch: number, anchors: AnchorRow[], required: string[]): string {
  const chapter = plan.master.chapters.find((c) => c.chapterIndex === ch);
  const beats = [...(plan.section.beats ?? [])].sort((a, b) => a.order - b.order).map((b) => b.kind.replace(/_/g, " "));
  const lines = [`APPROVED PLAN (v${plan.masterVersion}) — writer's view:`];
  if (chapter) lines.push(`Chapter goal [${chapter.objectiveKind}]: ${chapter.objective}`);
  lines.push(`Section goal: ${plan.section.objective}${beats.length ? ` — beats: ${beats.join(" → ")}` : ""}. Length ~${plan.section.targetWords} words is an estimate; never pad or cut.`);
  for (const r of plan.master.reveals.filter((x) => x.revealChapter <= ch)) lines.push(`Already revealed${r.revealChapter === ch ? " IN THIS CHAPTER" : ""}: ${r.summary}`);
  for (const f of foreshadowFor(plan.master, ch)) lines.push(f.text);
  const req = new Set(required);
  for (const a of anchors) lines.push(`EXACT${req.has(a.anchor_key) ? " (REQUIRED in this section)" : " (if mentioned)"}: ${a.anchor_key} = "${a.exact_text}"`);
  return lines.join("\n");
}

// ---------- Contradictions → author reconciliation ----------
export interface DiscrepancyInput { severity: "CRITICAL" | "MAJOR"; type: "CANON_CONFLICT" | "ANCHOR_MISMATCH"; description: string; excerpt: string; canonRef: Row; dedupSuffix: string }

/**
 * Only serious, unresolved findings go to the author: continuity ERRORs at HIGH/CRITICAL that
 * survived automatic revision, and required exact details still wrong after bounded repair.
 * Warnings, ambiguity and minor issues never block writing.
 */
export function discrepanciesFor(unresolvedIssues: Row[], anchorViolations: AnchorViolation[]): DiscrepancyInput[] {
  const out: DiscrepancyInput[] = [];
  for (const i of unresolvedIssues) {
    if (i.classification !== "ERROR" || !["CRITICAL", "HIGH"].includes(i.severity)) continue;
    out.push({ severity: i.severity === "CRITICAL" ? "CRITICAL" : "MAJOR", type: "CANON_CONFLICT", description: String(i.explanation ?? i.type).slice(0, 2000),
      excerpt: String(i.excerpt ?? "").slice(0, 2000), canonRef: { evidence: i.conflictingEvidence ?? null, authority: i.authority ?? null, entity: i.entity ?? null },
      dedupSuffix: `${i.type}:${String(i.excerpt ?? "").slice(0, 80)}` });
  }
  for (const v of anchorViolations) out.push({ severity: "MAJOR", type: "ANCHOR_MISMATCH", description: `Required exact detail "${v.key}" ${v.kind === "variant" ? "appears in a wrong form" : "is missing"}; expected "${v.expected}".`,
    excerpt: "", canonRef: { anchor_key: v.key, expected: v.expected }, dedupSuffix: `anchor:${v.key}` });
  return out;
}
