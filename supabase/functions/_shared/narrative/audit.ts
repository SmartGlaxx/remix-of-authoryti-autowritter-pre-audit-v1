// Pass 5 — Manuscript-level auditor: pure logic (no I/O). AUDIT-ONLY.
// Nothing here rewrites prose, mutates canon, closes threads or deletes chapters.
// Shared by the run-manuscript-audit edge function, the browser and tests.
import { normText, toPosition } from "./rules.ts";
import { isNonfiction as isNonfictionType, parseJsonLoose } from "./continuity.ts";
import type { NarrativeRows } from "./context.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export type AuditSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export const AUDIT_SEVERITY_RANK: Record<AuditSeverity, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
export type AuditCategory =
  | "structural" | "plot_thread" | "character_arc" | "character_knowledge" | "timeline"
  | "canonical_fact" | "continuity_history" | "promise_payoff" | "nonfiction_consistency" | "redundancy";
export const AUDIT_CATEGORIES: AuditCategory[] = ["structural", "plot_thread", "character_arc", "character_knowledge", "timeline", "canonical_fact", "continuity_history", "promise_payoff", "nonfiction_consistency", "redundancy"];

export const AUDIT_STAGES = [
  "structural", "plot_threads", "character_arcs", "character_knowledge", "timeline_causality",
  "canonical_facts", "continuity_history", "promise_payoff", "nonfiction_consistency", "redundancy",
  "evidence_validation", "deduplication",
] as const;
export type AuditStage = typeof AUDIT_STAGES[number];
export type StageStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export interface StageProgress { status: StageStatus; started_at: string | null; completed_at: string | null; finding_count: number; error: string | null }

/** Stages answered by the model (the rest are deterministic, computed from stored state). */
export const LLM_STAGES: AuditStage[] = ["structural", "character_arcs", "character_knowledge", "timeline_causality", "promise_payoff", "nonfiction_consistency"];
export const STAGE_CATEGORY: Partial<Record<AuditStage, AuditCategory>> = {
  structural: "structural", plot_threads: "plot_thread", character_arcs: "character_arc", character_knowledge: "character_knowledge",
  timeline_causality: "timeline", canonical_facts: "canonical_fact", continuity_history: "continuity_history",
  promise_payoff: "promise_payoff", nonfiction_consistency: "nonfiction_consistency", redundancy: "redundancy",
};

export const isNonfiction = isNonfictionType;

export function initialStageProgress(bookType: string | null | undefined): Record<AuditStage, StageProgress> {
  const nf = isNonfiction(bookType);
  const out = {} as Record<AuditStage, StageProgress>;
  for (const s of AUDIT_STAGES) {
    const skip = (s === "nonfiction_consistency" && !nf) || ((s === "character_arcs" || s === "character_knowledge") && nf);
    out[s] = { status: skip ? "skipped" : "pending", started_at: null, completed_at: null, finding_count: 0, error: null };
  }
  return out;
}

// ---------- Hashing & cache key ----------

export async function sha256Hex(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const TIMESTAMP_KEYS = new Set(["created_at", "updated_at"]);
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    const o = v as Row;
    return Object.fromEntries(Object.keys(o).filter((k) => !TIMESTAMP_KEYS.has(k)).sort().map((k) => [k, canonicalize(o[k])]));
  }
  return v;
}
const byId = (a: Row, b: Row) => String(a.id ?? "").localeCompare(String(b.id ?? ""));

/** Deterministic serialization of the narrative state (content only, timestamps excluded, rows sorted). */
export function serializeNarrativeState(rows: NarrativeRows): string {
  const pairKey = (r: Row) => Object.keys(r).filter((k) => k.endsWith("_id")).sort().map((k) => String(r[k])).join("|");
  const tables: Record<string, Row[]> = {
    characters: [...rows.characters].sort(byId), states: [...rows.states].sort(byId), events: [...rows.events].sort(byId),
    threads: [...rows.threads].sort(byId), facts: [...rows.facts].sort(byId), timeline: [...rows.timeline].sort(byId),
    entities: [...rows.entities].sort(byId),
    participants: [...rows.participants].sort((a, b) => pairKey(a).localeCompare(pairKey(b))),
    threadEvents: [...rows.threadEvents].sort((a, b) => pairKey(a).localeCompare(pairKey(b))),
  };
  return JSON.stringify(canonicalize(tables));
}

export async function computeAuditInputs(opts: { manuscript: string; outline: unknown; rows: NarrativeRows; continuityChecks?: Row[] }) {
  const manuscript_hash = await sha256Hex(opts.manuscript);
  const outline_hash = await sha256Hex(JSON.stringify(canonicalize(stripOutlineContent(opts.outline))));
  const checks = [...(opts.continuityChecks ?? [])].sort(byId).map((c) => ({ id: c.id, status: c.status, resolution_status: c.resolution_status }));
  const narrative_state_version = await sha256Hex(serializeNarrativeState(opts.rows) + JSON.stringify(checks));
  const cache_key = await sha256Hex(`${manuscript_hash}:${outline_hash}:${narrative_state_version}`);
  return { manuscript_hash, outline_hash, narrative_state_version, cache_key };
}

/** Outline structure without prose (prose is covered by manuscript_hash). */
function stripOutlineContent(outline: unknown): unknown {
  if (!outline || typeof outline !== "object") return null;
  const o = outline as Row;
  return {
    ...o,
    chapters: Array.isArray(o.chapters) ? o.chapters.map((c: Row) => ({
      ...c, subsections: Array.isArray(c.subsections) ? c.subsections.map((s: Row) => {
        const { content: _c, status: _s, continuity: _k, ...rest } = s ?? {};
        return rest;
      }) : [],
    })) : [],
  };
}

// ---------- Manuscript map ----------

export interface ManuscriptSection { chapterIndex: number; subsectionIndex: number; chapterTitle: string; title: string; summary: string; content: string; words: number; status: string }

export function buildManuscriptSections(outline: unknown): ManuscriptSection[] {
  const chapters = (outline as Row)?.chapters;
  if (!Array.isArray(chapters)) return [];
  const out: ManuscriptSection[] = [];
  chapters.forEach((c: Row, ci: number) => {
    (Array.isArray(c?.subsections) ? c.subsections : []).forEach((s: Row, si: number) => {
      const content = typeof s?.content === "string" ? s.content : "";
      out.push({
        chapterIndex: ci, subsectionIndex: si, chapterTitle: String(c?.title ?? `Chapter ${ci + 1}`), title: String(s?.title ?? ""),
        summary: String(s?.summary ?? s?.description ?? ""), content, words: content.trim() ? content.trim().split(/\s+/).length : 0,
        status: String(s?.status ?? "pending"),
      });
    });
  });
  return out;
}

export const manuscriptText = (sections: ManuscriptSection[]) => sections.filter((s) => s.content.trim()).map((s) => s.content).join("\n\n");

/**
 * Hierarchical, bounded view of the manuscript for the model. Small books go in whole;
 * large books are staged: each section keeps its opening and closing (where setups and
 * turns live) so the view stays within budget without sending raw text repeatedly.
 */
export function renderManuscriptDigest(sections: ManuscriptSection[], budgetChars = 350_000): string {
  const written = sections.filter((s) => s.content.trim());
  const total = written.reduce((n, s) => n + s.content.length, 0);
  const perSection = total <= budgetChars ? Infinity : Math.max(600, Math.floor(budgetChars / Math.max(1, written.length)));
  return written.map((s) => {
    const head = `[[Ch ${s.chapterIndex + 1}.${s.subsectionIndex + 1} — ${s.chapterTitle}${s.title ? ` / ${s.title}` : ""}]]`;
    if (s.content.length <= perSection) return `${head}\n${s.content}`;
    const half = Math.floor(perSection / 2);
    return `${head}\n${s.content.slice(0, half)}\n[…section condensed…]\n${s.content.slice(-half)}`;
  }).join("\n\n");
}

// ---------- Evidence verification ----------

const quoteNorm = (s: string) => normText(s.replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'").replace(/[.…,;:!?"']+$/g, "").replace(/^["']+/, ""));
export interface EvidenceLocation { chapterIndex: number; subsectionIndex: number }

/** Finds where an excerpt genuinely appears (whitespace/quote-insensitive). Null = fabricated/unverifiable. */
export function verifyExcerptInManuscript(excerpt: string | null | undefined, sections: ManuscriptSection[]): EvidenceLocation | null {
  if (!excerpt) return null;
  const e = quoteNorm(excerpt);
  if (e.length < 8) return null;
  for (const s of sections) if (s.content && quoteNorm(s.content).includes(e)) return { chapterIndex: s.chapterIndex, subsectionIndex: s.subsectionIndex };
  return null;
}

export interface RelatedIds { facts: string[]; events: string[]; characters: string[]; threads: string[]; checks: string[] }
export const emptyRelated = (): RelatedIds => ({ facts: [], events: [], characters: [], threads: [], checks: [] });

export interface EvidenceIndex { facts: Map<string, Row>; events: Set<string>; characters: Set<string>; threads: Set<string>; states: Set<string>; checks: Set<string> }
export function buildEvidenceIndex(rows: NarrativeRows, checks: Row[] = []): EvidenceIndex {
  return {
    facts: new Map(rows.facts.map((f) => [String(f.id), f])), events: new Set(rows.events.map((r) => String(r.id))),
    characters: new Set(rows.characters.map((r) => String(r.id))), threads: new Set(rows.threads.map((r) => String(r.id))),
    states: new Set(rows.states.map((r) => String(r.id))), checks: new Set(checks.map((r) => String(r.id))),
  };
}

// ---------- Findings ----------

export interface RawFinding {
  category: AuditCategory; severity: AuditSeverity; confidence: number; title: string; description: string;
  evidenceExcerpt: string | null; contradictingExcerpt: string | null; contradictingEvidence: string | null;
  related: RelatedIds; explanation: string; suggestedAction: string;
  /** Deterministic stages already know their location. */
  evidenceLocation?: EvidenceLocation | null; contradictingLocation?: EvidenceLocation | null;
}

export interface ValidatedFinding extends RawFinding {
  verification: "VERIFIED" | "UNCERTAIN";
  evidenceLocation: EvidenceLocation | null; contradictingLocation: EvidenceLocation | null;
  userCanonProtected: boolean; dedupKey: string;
}

export type RejectReason = "no_evidence" | "fabricated_excerpt" | "fabricated_ids" | "style_or_pacing" | "invalid";

const STYLE_RE = /\b(prose style|writing style|pacing|word choice|writing quality|sentence variety|sentence structure|tone of voice|too slow|too fast|flowery|purple prose|readability)\b/i;
/** Style, writing quality, tone and pacing preferences are never audit findings (Pass 4 boundary preserved). */
export const isStyleOrPacing = (f: Pick<RawFinding, "title" | "description" | "category">) =>
  f.category !== "redundancy" && STYLE_RE.test(`${f.title} ${f.description}`);

const s = (v: unknown, max = 1000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const clamp01 = (n: unknown) => { const x = Number(n); return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0; };
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => x.trim()).slice(0, 20) : []);

/** Parses one LLM stage's JSON output. Throws on unparseable output (stage → failed, never "clean"). */
export function parseStageOutput(raw: string, category: AuditCategory): RawFinding[] {
  const data = parseJsonLoose(raw) as { findings?: unknown };
  if (!data || typeof data !== "object" || !Array.isArray(data.findings)) throw new Error("Auditor output missing findings array");
  const out: RawFinding[] = [];
  for (const r of data.findings as Row[]) {
    if (!r || typeof r !== "object") continue;
    const title = s(r.title, 200);
    if (!title) continue;
    const rel = (r.related ?? {}) as Row;
    out.push({
      category, severity: normalizeSeverity(r.severity), confidence: clamp01(r.confidence), title,
      description: s(r.description, 800), evidenceExcerpt: s(r.evidenceExcerpt, 600) || null,
      contradictingExcerpt: s(r.contradictingExcerpt, 600) || null, contradictingEvidence: s(r.contradictingEvidence, 800) || null,
      related: { facts: ids(rel.facts), events: ids(rel.events), characters: ids(rel.characters), threads: ids(rel.threads), checks: ids(rel.checks) },
      explanation: s(r.explanation, 1000), suggestedAction: s(r.suggestedAction, 600),
    });
  }
  return out;
}

export function normalizeSeverity(v: unknown): AuditSeverity {
  return (["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).includes(v as AuditSeverity) ? (v as AuditSeverity) : "MEDIUM";
}

export function dedupKey(f: Pick<RawFinding, "category" | "title" | "evidenceExcerpt" | "related">): string {
  const r = f.related;
  const idPart = [...r.facts, ...r.events, ...r.characters, ...r.threads, ...r.checks].sort().join(",");
  const anchor = f.evidenceExcerpt ? quoteNorm(f.evidenceExcerpt).slice(0, 120) : quoteNorm(f.title).slice(0, 120);
  return `${f.category}|${anchor}|${idPart}`;
}

/**
 * Dual evidence validation (prose + structured DB records):
 *  - a prose excerpt that is not in the manuscript is fabricated → reject;
 *  - cited DB ids that don't exist are removed; if nothing verifiable remains → reject; partial → UNCERTAIN;
 *  - a finding needs at least one verified excerpt or valid record;
 *  - USER_CANON involvement marks it protected (author review) but never inflates severity.
 */
export function validateFinding(f: RawFinding, sections: ManuscriptSection[], idx: EvidenceIndex): { ok: true; finding: ValidatedFinding } | { ok: false; reason: RejectReason } {
  if (!f.title) return { ok: false, reason: "invalid" };
  if (isStyleOrPacing(f)) return { ok: false, reason: "style_or_pacing" };
  let uncertain = false;

  let evidenceLocation = f.evidenceLocation ?? null;
  if (f.evidenceExcerpt && !evidenceLocation) {
    evidenceLocation = verifyExcerptInManuscript(f.evidenceExcerpt, sections);
    if (!evidenceLocation) return { ok: false, reason: "fabricated_excerpt" };
  }
  let contradictingLocation = f.contradictingLocation ?? null;
  let contradictingExcerpt = f.contradictingExcerpt;
  if (contradictingExcerpt && !contradictingLocation) {
    contradictingLocation = verifyExcerptInManuscript(contradictingExcerpt, sections);
    if (!contradictingLocation) { contradictingExcerpt = null; uncertain = true; }
  }

  const keep = (list: string[], ok: (id: string) => boolean) => { const v = list.filter(ok); if (v.length !== list.length) uncertain = true; return v; };
  const related: RelatedIds = {
    facts: keep(f.related.facts, (i) => idx.facts.has(i)), events: keep(f.related.events, (i) => idx.events.has(i)),
    characters: keep(f.related.characters, (i) => idx.characters.has(i) || idx.states.has(i)),
    threads: keep(f.related.threads, (i) => idx.threads.has(i)), checks: keep(f.related.checks, (i) => idx.checks.has(i)),
  };
  const citedAny = Object.values(f.related).some((l) => l.length > 0);
  const validAny = Object.values(related).some((l) => l.length > 0);
  if (!evidenceLocation && !validAny) return { ok: false, reason: citedAny ? "fabricated_ids" : "no_evidence" };

  const userCanonProtected = related.facts.some((id) => idx.facts.get(id)?.authority === "USER_CANON");
  const finding: ValidatedFinding = {
    ...f, contradictingExcerpt, related, evidenceLocation, contradictingLocation,
    verification: uncertain ? "UNCERTAIN" : "VERIFIED", userCanonProtected, dedupKey: "",
  };
  finding.dedupKey = dedupKey(finding);
  return { ok: true, finding };
}

/** Collapses duplicates across stages: keeps the highest severity, then highest confidence, merging related ids. */
/** Cross-stage key: the same passage (and same counter-passage) flagged by several stages is one problem. */
export function crossStageKey(f: ValidatedFinding): string {
  if (!f.evidenceExcerpt) return f.dedupKey;
  const loc = (l: EvidenceLocation | null) => (l ? `${l.chapterIndex}.${l.subsectionIndex}` : "-");
  return `x|${loc(f.evidenceLocation)}|${quoteNorm(f.evidenceExcerpt).split(" ").slice(0, 5).join(" ")}|${loc(f.contradictingLocation)}`;
}

/** Same pair of passages (in either order) flagged with different quotes is still one problem. */
export function locationPairKey(f: ValidatedFinding): string {
  const a = f.evidenceLocation, b = f.contradictingLocation;
  if (!a || !b) return crossStageKey(f);
  const pair = [`${a.chapterIndex}.${a.subsectionIndex}`, `${b.chapterIndex}.${b.subsectionIndex}`].sort().join("~");
  const nums = (f.title + " " + (f.evidenceExcerpt ?? "")).match(/\d+(?:\.\d+)?%?/g)?.sort().join(",") ?? "";
  return `p|${pair}|${nums}`;
}

/**
 * Severity calibration (applied after validation, before dedup). Never inflates:
 *  - CRITICAL needs confidence ≥ 0.8 AND concrete two-sided proof (counter-passage or verified records), else → HIGH;
 *  - HIGH below 0.6 confidence → MEDIUM;
 *  - UNCERTAIN verification caps at MEDIUM.
 */
export function calibrateSeverity(f: ValidatedFinding): ValidatedFinding {
  let sev = f.severity;
  const twoSided = !!f.contradictingLocation || Object.values(f.related).some((l) => l.length > 0);
  if (sev === "CRITICAL" && (f.confidence < 0.8 || !twoSided)) sev = "HIGH";
  if (sev === "HIGH" && f.confidence < 0.6) sev = "MEDIUM";
  if (f.verification === "UNCERTAIN" && AUDIT_SEVERITY_RANK[sev] > AUDIT_SEVERITY_RANK.MEDIUM) sev = "MEDIUM";
  return sev === f.severity ? f : { ...f, severity: sev };
}

export function deduplicateFindings(list: ValidatedFinding[]): ValidatedFinding[] {
  return mergeBy(mergeBy(mergeBy(list.map(calibrateSeverity), (f) => f.dedupKey), crossStageKey), locationPairKey);
}

/** Prompt for the semantic consolidation pass: the model may only GROUP existing findings, never add or edit them. */
export function buildConsolidationPrompt(list: ValidatedFinding[]): { system: string; user: string } {
  return {
    system: `You group audit findings that describe the SAME underlying problem (e.g. one recurring name-reuse issue reported for several names, or one statistic clash reported by several checks). Never merge different problems. Return ONLY JSON: {"groups":[[indexes],...]} listing only groups of 2+ findings.`,
    user: list.map((f, i) => `${i}. [${f.category}] ${f.title} — ${f.description.slice(0, 200)}`).join("\n"),
  };
}

/** Applies model-proposed groups deterministically; invalid/overlapping indexes are ignored. Keeps the strongest finding, merges ids, notes the others. */
export function applyConsolidation(list: ValidatedFinding[], raw: string): ValidatedFinding[] {
  let groups: unknown;
  try { groups = (parseJsonLoose(raw) as { groups?: unknown })?.groups; } catch { return list; }
  if (!Array.isArray(groups)) return list;
  const owner = new Map<number, number>();
  groups.forEach((g, gi) => {
    if (!Array.isArray(g)) return;
    const ok = [...new Set(g.filter((i) => Number.isInteger(i) && i >= 0 && i < list.length && !owner.has(i)))] as number[];
    if (ok.length >= 2) ok.forEach((i) => owner.set(i, gi));
  });
  const out: ValidatedFinding[] = [];
  const byGroup = new Map<number, ValidatedFinding[]>();
  list.forEach((f, i) => { const g = owner.get(i); if (g === undefined) out.push(f); else byGroup.set(g, [...(byGroup.get(g) ?? []), f]); });
  for (const members of byGroup.values()) {
    const [top] = mergeBy(members, () => "g");
    const others = members.filter((m) => m !== members.find((x) => x.dedupKey === top.dedupKey)).map((m) => m.title);
    out.push({ ...top, explanation: [top.explanation, others.length ? `Also reported as: ${others.join("; ")}` : ""].filter(Boolean).join(" ").slice(0, 1500) });
  }
  return out.sort((a, b) => AUDIT_SEVERITY_RANK[b.severity] - AUDIT_SEVERITY_RANK[a.severity] || b.confidence - a.confidence);
}

function mergeBy(list: ValidatedFinding[], keyOf: (f: ValidatedFinding) => string): ValidatedFinding[] {
  const map = new Map<string, ValidatedFinding>();
  for (const f of list) {
    const k = keyOf(f);
    const prev = map.get(k);
    if (!prev) { map.set(k, f); continue; }
    const better = AUDIT_SEVERITY_RANK[f.severity] > AUDIT_SEVERITY_RANK[prev.severity] ||
      (f.severity === prev.severity && f.confidence > prev.confidence) ? f : prev;
    const other = better === f ? prev : f;
    const merge = (a: string[], b: string[]) => [...new Set([...a, ...b])];
    map.set(k, {
      ...better,
      related: { facts: merge(better.related.facts, other.related.facts), events: merge(better.related.events, other.related.events), characters: merge(better.related.characters, other.related.characters), threads: merge(better.related.threads, other.related.threads), checks: merge(better.related.checks, other.related.checks) },
      userCanonProtected: better.userCanonProtected || other.userCanonProtected,
    });
  }
  return [...map.values()].sort((a, b) => AUDIT_SEVERITY_RANK[b.severity] - AUDIT_SEVERITY_RANK[a.severity] || b.confidence - a.confidence);
}

// ---------- Deterministic stages ----------

export type ThreadClass = "OPEN_INTENTIONAL" | "OPEN_UNRESOLVED" | "RESOLVED" | "ABANDONED" | "SUPERSEDED" | "UNCERTAIN";

/**
 * Classifies a plot thread at the end of the manuscript.
 * `bookComplete` = every outlined section is written; an unfinished book can't have unresolved threads yet.
 */
export function classifyPlotThread(t: Row, opts: { bookComplete: boolean }): ThreadClass {
  const status = String(t.status ?? "").toUpperCase();
  if (status === "RESOLVED") return "RESOLVED";
  if (status === "SUPERSEDED" || t.superseded_by) return "SUPERSEDED";
  if (status === "ABANDONED") return "ABANDONED";
  if (status !== "OPEN" && status !== "DEVELOPING") return "UNCERTAIN";
  const text = `${t.description ?? ""} ${t.resolution_notes ?? ""} ${t.setup_promise ?? ""}`;
  if (/\b(sequel|series|intentional(ly)? (open|unresolved)|left open|cliffhanger|ambiguous ending)\b/i.test(text)) return "OPEN_INTENTIONAL";
  if (!opts.bookComplete) return "UNCERTAIN";
  return "OPEN_UNRESOLVED";
}

export function plotThreadFindings(rows: NarrativeRows, bookComplete: boolean): RawFinding[] {
  const out: RawFinding[] = [];
  for (const t of rows.threads) {
    const cls = classifyPlotThread(t, { bookComplete });
    if (cls === "OPEN_UNRESOLVED") {
      const major = t.importance === "major";
      out.push({
        category: "plot_thread", severity: major ? "HIGH" : "LOW", confidence: 0.9,
        title: `Unresolved ${major ? "major" : "minor"} plot thread: ${String(t.title).slice(0, 120)}`,
        description: `This thread is still ${String(t.status).toLowerCase()} at the end of the manuscript.`,
        evidenceExcerpt: null, contradictingExcerpt: null, contradictingEvidence: t.required_resolution ? `Required resolution: ${t.required_resolution}` : null,
        related: { ...emptyRelated(), threads: [String(t.id)] },
        explanation: (t.unresolved_questions ?? []).length ? `Open questions: ${(t.unresolved_questions as string[]).join("; ")}` : "No resolution event was recorded.",
        suggestedAction: "Resolve it, or mark it as intentionally left open.",
        evidenceLocation: Number.isInteger(t.introduced_chapter_index) ? { chapterIndex: t.introduced_chapter_index, subsectionIndex: t.introduced_subsection_index ?? 0 } : null,
      });
    } else if (cls === "ABANDONED" && t.importance === "major") {
      out.push({
        category: "plot_thread", severity: "MEDIUM", confidence: 0.8, title: `Major thread abandoned: ${String(t.title).slice(0, 120)}`,
        description: "A major thread was marked abandoned without a resolution.", evidenceExcerpt: null, contradictingExcerpt: null, contradictingEvidence: null,
        related: { ...emptyRelated(), threads: [String(t.id)] }, explanation: String(t.resolution_notes ?? ""), suggestedAction: "Confirm the thread should be dropped.",
      });
    }
  }
  return out;
}

/** Disputed facts that conflict with authoritative canon. Disputed/AI_INFERENCE facts are never authoritative on their own. */
export function canonicalFactFindings(rows: NarrativeRows): RawFinding[] {
  const out: RawFinding[] = [];
  const byId = new Map(rows.facts.map((f) => [String(f.id), f]));
  for (const f of rows.facts) {
    if (f.conflict_status !== "disputed" || !f.conflicting_fact_id) continue;
    const canon = byId.get(String(f.conflicting_fact_id));
    if (!canon || !canon.is_canonical) continue;
    if (canon.authority !== "USER_CANON" && canon.authority !== "OUTLINE_CANON") continue;
    const impact = String(canon.category) === "plot" ? "HIGH" : "MEDIUM";
    out.push({
      category: "canonical_fact", severity: impact, confidence: Math.min(0.95, Number(f.confidence) || 0.7),
      title: `Manuscript contradicts ${canon.authority === "USER_CANON" ? "your" : "outline"} canon: ${canon.subject} ${canon.predicate}`.slice(0, 200),
      description: `Established: "${canon.value}". The manuscript suggests: "${f.value}".`,
      evidenceExcerpt: f.source_excerpt ?? null, contradictingExcerpt: null, contradictingEvidence: `${canon.authority}: ${canon.subject} ${canon.predicate} ${canon.value}`,
      related: { ...emptyRelated(), facts: [String(f.id), String(canon.id)] },
      explanation: "The later statement was recorded as disputed; the established fact remains canonical.",
      suggestedAction: "Review the passage; canon is never changed automatically.",
      evidenceLocation: Number.isInteger(f.source_chapter_index) ? { chapterIndex: f.source_chapter_index, subsectionIndex: f.source_subsection_index ?? 0 } : null,
    });
  }
  return out;
}

/** Pass 4 sections still awaiting author review, or never checked. */
export function continuityHistoryFindings(checks: Row[], sections: ManuscriptSection[]): RawFinding[] {
  const latest = new Map<string, Row>();
  for (const c of [...checks].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) latest.set(`${c.chapter_index}:${c.subsection_index}`, c);
  const out: RawFinding[] = [];
  for (const [key, c] of latest) {
    const [ch, sub] = key.split(":").map(Number);
    const sec = sections.find((x) => x.chapterIndex === ch && x.subsectionIndex === sub);
    if (!sec?.content.trim()) continue;
    if (c.status === "NEEDS_REVIEW" && c.resolution_status !== "acknowledged" && c.resolution_status !== "resolved") {
      const sev = normalizeSeverity(c.max_severity);
      out.push({
        category: "continuity_history", severity: sev, confidence: Number(c.confidence) || 0.7,
        title: `Section ${ch + 1}.${sub + 1} still needs continuity review`,
        description: `${(c.issues as unknown[] | null)?.length ?? 0} unresolved continuity issue(s) from the section check.`,
        evidenceExcerpt: null, contradictingExcerpt: null, contradictingEvidence: null,
        related: { ...emptyRelated(), checks: [String(c.id)] }, explanation: "This section was kept out of story memory until reviewed.",
        suggestedAction: "Open the section and review the continuity issues.", evidenceLocation: { chapterIndex: ch, subsectionIndex: sub },
      });
    } else if (c.status === "CHECK_FAILED") {
      out.push({
        category: "continuity_history", severity: "LOW", confidence: 0.9, title: `Section ${ch + 1}.${sub + 1} was never continuity-checked`,
        description: "The section check failed, so this section was not verified.", evidenceExcerpt: null, contradictingExcerpt: null, contradictingEvidence: null,
        related: { ...emptyRelated(), checks: [String(c.id)] }, explanation: String(c.error ?? ""), suggestedAction: "Re-run the check on this section.",
        evidenceLocation: { chapterIndex: ch, subsectionIndex: sub },
      });
    }
  }
  return out;
}

/** Repeated passages across different sections (≥ 12 words, verbatim after normalization). */
export function redundancyFindings(sections: ManuscriptSection[], minWords = 12): RawFinding[] {
  const seen = new Map<string, { loc: EvidenceLocation; raw: string }>();
  const out: RawFinding[] = [];
  const reported = new Set<string>();
  for (const sec of sections) {
    const sentences = sec.content.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.split(/\s+/).length >= minWords);
    for (const raw of sentences) {
      const key = normText(raw);
      const prev = seen.get(key);
      const loc = { chapterIndex: sec.chapterIndex, subsectionIndex: sec.subsectionIndex };
      if (!prev) { seen.set(key, { loc, raw }); continue; }
      if (prev.loc.chapterIndex === loc.chapterIndex && prev.loc.subsectionIndex === loc.subsectionIndex) continue;
      if (reported.has(key)) continue;
      reported.add(key);
      out.push({
        category: "redundancy", severity: "LOW", confidence: 1, title: `Passage repeated in sections ${prev.loc.chapterIndex + 1}.${prev.loc.subsectionIndex + 1} and ${loc.chapterIndex + 1}.${loc.subsectionIndex + 1}`,
        description: "The same sentence appears verbatim in two sections.", evidenceExcerpt: raw.slice(0, 600), contradictingExcerpt: prev.raw.slice(0, 600),
        contradictingEvidence: null, related: emptyRelated(), explanation: "Verbatim repetition across sections.", suggestedAction: "Keep it in one place only.",
        evidenceLocation: loc, contradictingLocation: prev.loc,
      });
    }
  }
  return out;
}

/** Structural gaps visible without a model: skipped sections between written ones. */
export function structuralGapFindings(sections: ManuscriptSection[]): RawFinding[] {
  const lastWritten = [...sections].reverse().find((x) => x.content.trim());
  if (!lastWritten) return [];
  const limit = toPosition(lastWritten);
  return sections.filter((x) => !x.content.trim() && toPosition(x) < limit).map((x) => ({
    category: "structural" as const, severity: "HIGH" as const, confidence: 1,
    title: `Section ${x.chapterIndex + 1}.${x.subsectionIndex + 1} is empty but later sections are written`,
    description: `"${x.title || x.chapterTitle}" has no text.`, evidenceExcerpt: null, contradictingExcerpt: null, contradictingEvidence: null,
    related: emptyRelated(), explanation: "Readers would skip a planned part of the book.", suggestedAction: "Write this section or remove it from the outline.",
    evidenceLocation: { chapterIndex: x.chapterIndex, subsectionIndex: x.subsectionIndex },
  }));
}

// ---------- LLM stage prompts ----------

const STAGE_FOCUS: Partial<Record<AuditStage, string>> = {
  structural: "Structural progression and scene flow across the WHOLE book: chapters that contradict the outline's purpose, missing transitions between chapters, scenes that happen out of logical order, outline promises for a chapter that the chapter never delivers.",
  character_arcs: "Character arcs: characters whose motivation, personality or relationships change without cause across chapters; arcs set up and then dropped; characters who vanish without explanation.",
  character_knowledge: "Character knowledge timeline: a character acting on information they could not yet know, or forgetting something they clearly learned earlier.",
  timeline_causality: "Timeline and causality: events in an impossible order, effects before causes, travel/time spans that don't add up, flashbacks that contradict the present timeline.",
  promise_payoff: "Promises and payoffs: setups (clues, foreshadowing, the introduction's promises, a stated goal) that never pay off, and payoffs that were never set up. Also whether the ending resolves the central conflict or question.",
  nonfiction_consistency: "Internal consistency of a nonfiction book: contradictory claims, numbers or statistics that change between chapters, frameworks or step names that drift, recommendations that contradict earlier advice, introduction promises not delivered. Do NOT fact-check against the outside world.",
};

export function buildAuditPrompt(stage: AuditStage, opts: { digest: string; stateText: string; outlineText: string; nonfiction: boolean; idCatalog: string }): { system: string; user: string } {
  const system = `You are a manuscript auditor. You DIAGNOSE; you never rewrite.
Report only substantiated, material problems for this focus: ${STAGE_FOCUS[stage]}
Rules:
- Every finding needs evidence: "evidenceExcerpt" copied VERBATIM from the manuscript (8+ chars), and/or record ids from the ID CATALOG in "related". Never invent quotes or ids.
- If the contradiction is between two passages, put the second one verbatim in "contradictingExcerpt".
- Never report prose style, writing quality, tone or pacing preferences.
- Legitimate change (a character growing, a deliberate twist, a flashback) is not an error.
- Severity reflects impact on the manuscript: CRITICAL breaks the central story/argument; HIGH a clear contradiction a reader will notice; MEDIUM a noticeable inconsistency; LOW a minor structural, continuity, terminology, information-flow, or redundancy issue with limited impact.
- Who established a fact does not change severity.
- Calibrate conservatively: CRITICAL is rare (the book's central plot or argument no longer works); when unsure between two levels, choose the lower one.
- Report each underlying problem once, even if it shows up in several passages.
- If nothing is wrong, return {"findings": []}.
Return ONLY JSON: {"findings":[{"severity":"...","confidence":0-1,"title":"...","description":"...","evidenceExcerpt":"...","contradictingExcerpt":"...","contradictingEvidence":"...","related":{"facts":[],"events":[],"characters":[],"threads":[],"checks":[]},"explanation":"...","suggestedAction":"..."}]}`;
  const user = `BOOK TYPE: ${opts.nonfiction ? "nonfiction" : "fiction"}

OUTLINE:
${opts.outlineText}

ESTABLISHED STORY MEMORY:
${opts.stateText || "(none recorded)"}

ID CATALOG (only these ids exist):
${opts.idCatalog || "(none)"}

MANUSCRIPT:
${opts.digest}`;
  return { system, user };
}

export function renderOutlineText(sections: ManuscriptSection[]): string {
  return sections.map((x) => `Ch ${x.chapterIndex + 1}.${x.subsectionIndex + 1} ${x.chapterTitle}${x.title ? ` / ${x.title}` : ""}${x.summary ? ` — ${x.summary.slice(0, 240)}` : ""}${x.content.trim() ? "" : " [not written]"}`).join("\n");
}

export function renderIdCatalog(rows: NarrativeRows, checks: Row[] = []): string {
  const lines: string[] = [];
  for (const c of rows.characters.slice(0, 200)) lines.push(`character ${c.id}: ${c.name}`);
  for (const f of rows.facts.filter((x) => x.is_canonical).slice(0, 400)) lines.push(`fact ${f.id} [${f.authority}]: ${f.subject} ${f.predicate} ${f.value}`);
  for (const e of rows.events.slice(0, 300)) lines.push(`event ${e.id} (ch ${Number(e.chapter_index) + 1}.${Number(e.subsection_index) + 1}): ${e.title}`);
  for (const t of rows.threads.slice(0, 200)) lines.push(`thread ${t.id} [${t.status}]: ${t.title}`);
  for (const c of checks.slice(0, 200)) lines.push(`check ${c.id} (ch ${Number(c.chapter_index) + 1}.${Number(c.subsection_index) + 1}): ${c.status}`);
  return lines.join("\n");
}

// ---------- Summary ----------

export function summarizeFindings(findings: ValidatedFinding[], rejected: Record<string, number>) {
  const bySeverity: Record<AuditSeverity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  const byCategory: Partial<Record<AuditCategory, number>> = {};
  let uncertain = 0, userCanon = 0;
  for (const f of findings) {
    bySeverity[f.severity]++;
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
    if (f.verification === "UNCERTAIN") uncertain++;
    if (f.userCanonProtected) userCanon++;
  }
  return { total: findings.length, bySeverity, byCategory, uncertain, userCanonProtected: userCanon, rejected };
}

export function toFindingRow(f: ValidatedFinding, ctx: { auditId: string; bookId: string; userId: string }) {
  return {
    audit_id: ctx.auditId, book_id: ctx.bookId, user_id: ctx.userId, category: f.category, severity: f.severity,
    confidence: f.confidence, verification: f.verification, title: f.title, concise_description: f.description,
    evidence_excerpt: f.evidenceExcerpt, evidence_location: f.evidenceLocation,
    contradicting_evidence: f.contradictingExcerpt ?? f.contradictingEvidence, contradicting_location: f.contradictingLocation,
    related_fact_ids: f.related.facts, related_event_ids: f.related.events, related_character_ids: f.related.characters,
    related_plot_thread_ids: f.related.threads, related_continuity_check_ids: f.related.checks,
    user_canon_protected: f.userCanonProtected, explanation: f.explanation, suggested_action: f.suggestedAction,
    auto_fixable: false, status: "OPEN", dedup_key: f.dedupKey,
  };
}
