// Phase 3 — character knowledge, scene chronology and epistemic checks (pure, no I/O).
// Safeguards:
//  1. Scene order comes from story dates first; chapter order is only a fallback for sections
//     that are not flashbacks/prequels. Unknown order stays "maybe", never guessed.
//  2. Only demonstrable impossibilities block; deception, unreliable narration, uncertain dates
//     and life changes (e.g. working after retirement) are advisory at most.
//  3. Secret terms appearing in prose is advisory; only a semantic disclosure blocks.
//  4. Knowledge attaches to exactly one stable identity id, or is held for the author.
import { ageAt, toInterval, narratorAccess, type ApproximateDate, type NarrativeVantage, type StoryPoint } from "./chronology.ts";
import { resolveIdentity, type KnownIdentity } from "./identityResolution.ts";
import type { ContextCandidate } from "./adaptiveContext.ts";
import type { Finding } from "./planning/validation.ts";

export const KNOWLEDGE_KINDS = ["knows", "believes", "suspects", "misunderstands", "conceals"] as const;
export const KNOWLEDGE_SOURCES = ["direct_witness", "testimony", "deduction", "document", "misinformation", "false_memory"] as const;
export const TRUTH = ["true", "false", "disputed", "unverified"] as const;
export type KnowledgeKind = typeof KNOWLEDGE_KINDS[number];
export type KnowledgeSource = typeof KNOWLEDGE_SOURCES[number];
export type Truth = typeof TRUTH[number];

export interface ExtractedKnowledge {
  character: string; claim: string; kind: KnowledgeKind; source: KnowledgeSource; truth: Truth;
  fromCharacter: string | null; storyDate: string | null; supersedes: string | null; evidence: string;
}

const s = (v: unknown, n = 400) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

/** Validates the model's knowledge list; items without verbatim evidence are dropped. */
export function parseKnowledge(raw: unknown, text: string, evidenceOk: (t: string, e: string | null) => boolean): { items: ExtractedKnowledge[]; dropped: number } {
  const items: ExtractedKnowledge[] = []; let dropped = 0;
  for (const k of (Array.isArray(raw) ? raw.slice(0, 60) : []) as Record<string, unknown>[]) {
    const character = s(k?.character, 120), claim = s(k?.claim, 400), evidence = s(k?.evidence, 600);
    if (!character || !claim || !evidenceOk(text, evidence)) { dropped++; continue; }
    const kind = pick(k.kind, KNOWLEDGE_KINDS, "knows");
    // A suspicion or misunderstanding can never be stored as certain knowledge.
    items.push({ character, claim, kind, source: pick(k.source, KNOWLEDGE_SOURCES, "deduction"), truth: pick(k.truth, TRUTH, "unverified"),
      fromCharacter: s(k.from_character, 120), storyDate: s(k.story_date, 60), supersedes: s(k.supersedes, 400), evidence: evidence! });
  }
  return { items, dropped };
}

export function certaintyFor(k: Pick<ExtractedKnowledge, "kind" | "truth">): "certain" | "suspected" | "disputed" | "false_belief" {
  if (k.truth === "false" || k.kind === "misunderstands") return "false_belief";
  if (k.kind === "suspects") return "suspected";
  if (k.truth === "disputed") return "disputed";
  return k.kind === "believes" && k.truth !== "true" ? "suspected" : "certain";
}

// ── Story dates ──────────────────────────────────────────────────────────────
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

/** Parses an explicit story date. Vague text ("that winter") stays null — never falsely precise. */
export function parseStoryDate(t: string | null | undefined): ApproximateDate | null {
  if (!t) return null;
  const x = t.toLowerCase().trim();
  let m = x.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return { precision: "exact", year: +m[1], month: +m[2], day: +m[3], rawText: t };
  m = x.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join("|")})\\s*,?\\s+(\\d{4})\\b`));
  if (m) return { precision: "exact", year: +m[3], month: MONTHS.indexOf(m[2]) + 1, day: +m[1], rawText: t };
  m = x.match(new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s+(\\d{4})\\b`));
  if (m) return { precision: "exact", year: +m[3], month: MONTHS.indexOf(m[1]) + 1, day: +m[2], rawText: t };
  m = x.match(new RegExp(`\\b(${MONTHS.join("|")})\\s+(?:of\\s+)?(\\d{4})\\b`));
  if (m) return { precision: "month_year", year: +m[2], month: MONTHS.indexOf(m[1]) + 1, rawText: t };
  m = x.match(/\b(?:around|about|circa|c\.|~)\s*(\d{4})\b/);
  if (m) return { precision: "approximate", year: +m[1], toleranceYears: 2, rawText: t };
  m = x.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  if (m) return { precision: "year", year: +m[1], rawText: t };
  return null;
}

/**
 * The story point of a section. Dated scenes use the date. An undated flashback/prequel gets NO
 * manuscript position, so its order relative to other scenes is "maybe" rather than assumed.
 */
export function scenePoint(o: { chapterIndex: number; subsectionIndex: number; storyDate?: string | ApproximateDate | null; nonLinear?: boolean }): StoryPoint {
  const date = typeof o.storyDate === "string" ? parseStoryDate(o.storyDate) : o.storyDate ?? null;
  if (date) return { date, chapterIndex: o.nonLinear ? undefined : o.chapterIndex, subsectionIndex: o.nonLinear ? undefined : o.subsectionIndex };
  return o.nonLinear ? {} : { chapterIndex: o.chapterIndex, subsectionIndex: o.subsectionIndex };
}

// ── Safeguard 4: identity resolution for knowledge holders ──────────────────
export type HolderResolution =
  | { status: "resolved"; identityId: string }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "no_identity" };

/** Exactly one same-name/alias match resolves. Anything else is held for the author. */
export function resolveKnowledgeHolder(name: string, identities: KnownIdentity[], universeId: string | null): HolderResolution {
  const r = resolveIdentity(identities, { displayName: name, universeId });
  if (r.status === "NEW") return { status: "no_identity" };
  const exact = r.matches.filter((m) => m.reason === "same_name" || m.reason === "alias_match");
  if (exact.length === 1 && r.matches.length === 1) return { status: "resolved", identityId: exact[0].id };
  if (exact.length === 1 && r.matches.every((m) => m === exact[0] || m.reason === "shared_name_token")) {
    // e.g. "Mara Quell" vs another "Mara ..." with a different surname is already excluded upstream;
    // a remaining token-only match still means the name is not unique → hold.
    return { status: "ambiguous", candidates: r.matches.map((m) => m.id) };
  }
  return { status: "ambiguous", candidates: r.matches.map((m) => m.id) };
}

export interface KnowledgeRow {
  identity_id: string; claim: string; knowledge_kind: KnowledgeKind; source: KnowledgeSource; truth_status: Truth;
  certainty: ReturnType<typeof certaintyFor>; source_identity_id: string | null; learned_date: ApproximateDate | null;
  learned_chapter_index: number | null; learned_subsection_index: number | null; evidence: string; scene_point: StoryPoint; dedup_key: string;
  supersedes: string | null;
}
export interface KnowledgeReview { character_name: string; reason: "ambiguous" | "no_identity"; candidate_identity_ids: string[]; payload: ExtractedKnowledge; dedup_key: string }

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
function hashKey(t: string): string { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0; return h.toString(36); }

/** Plans writes for one accepted section. Deterministic keys make retries idempotent. */
export function planKnowledgeWrites(items: ExtractedKnowledge[], o: {
  identities: KnownIdentity[]; universeId: string | null; bookId: string; chapterIndex: number; subsectionIndex: number;
  contentHash: string; sectionDate?: string | null; nonLinear?: boolean;
}): { rows: KnowledgeRow[]; reviews: KnowledgeReview[] } {
  const rows: KnowledgeRow[] = []; const reviews: KnowledgeReview[] = [];
  const sectionKey = `${o.chapterIndex}:${o.subsectionIndex}`;
  for (const k of items) {
    const holder = resolveKnowledgeHolder(k.character, o.identities, o.universeId);
    const base = `${o.bookId}|${sectionKey}|${o.contentHash}|${norm(k.character)}|${norm(k.claim)}`;
    if (holder.status !== "resolved") {
      reviews.push({ character_name: k.character, reason: holder.status, candidate_identity_ids: holder.status === "ambiguous" ? holder.candidates : [], payload: k, dedup_key: `kr_${hashKey(base)}_${base.length}` });
      continue;
    }
    const from = k.fromCharacter ? resolveKnowledgeHolder(k.fromCharacter, o.identities, o.universeId) : null;
    const point = scenePoint({ chapterIndex: o.chapterIndex, subsectionIndex: o.subsectionIndex, storyDate: k.storyDate ?? o.sectionDate ?? null, nonLinear: o.nonLinear });
    rows.push({
      identity_id: holder.identityId, claim: k.claim, knowledge_kind: k.kind, source: k.source, truth_status: k.truth, certainty: certaintyFor(k),
      source_identity_id: from?.status === "resolved" ? from.identityId : null, learned_date: point.date ?? null,
      learned_chapter_index: point.chapterIndex ?? null, learned_subsection_index: point.subsectionIndex ?? null,
      evidence: k.evidence, scene_point: point, dedup_key: `ka_${hashKey(base)}_${base.length}`, supersedes: k.supersedes,
    });
  }
  return { rows, reviews };
}

// ── Context: what the narrator may use in this scene ─────────────────────────
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const pointOf = (r: Row): StoryPoint => (r.scene_point && typeof r.scene_point === "object") ? r.scene_point as StoryPoint
  : { date: r.learned_date ?? null, chapterIndex: r.learned_chapter_index ?? undefined, subsectionIndex: r.learned_subsection_index ?? undefined };

export interface NarratorBoundaries { inScene: Row[]; hindsightOnly: Row[]; unknown: Row[]; uncertain: Row[] }

export function narratorBoundaries(rows: Row[], narratorId: string, scene: StoryPoint, vantage: NarrativeVantage, telling?: StoryPoint | null): NarratorBoundaries {
  const out: NarratorBoundaries = { inScene: [], hindsightOnly: [], unknown: [], uncertain: [] };
  for (const r of rows) {
    if (r.identity_id !== narratorId) continue;
    const superseded = r.superseded_chapter_index != null || r.superseded_date ? { date: r.superseded_date ?? null, chapterIndex: r.superseded_chapter_index ?? undefined } : null;
    const a = narratorAccess({ claim: r.claim, identityId: r.identity_id, learned: pointOf(r), certainty: r.certainty, superseded }, scene, vantage, telling);
    if (a.inScene === "yes") out.inScene.push(r);
    else if (a.hindsight === "yes") out.hindsightOnly.push(r);
    else if (a.inScene === "maybe") out.uncertain.push(r);
    else out.unknown.push(r);
  }
  return out;
}

const label = (r: Row) => r.certainty === "false_belief" ? "believes (mistakenly)" : r.certainty === "suspected" ? "suspects" : r.certainty === "disputed" ? "is unsure whether" : "knows";

/** Context candidates. Canonical reality is never handed to the narrator as their own knowledge. */
export function knowledgeCandidates(b: NarratorBoundaries, narratorName: string): ContextCandidate[] {
  const out: ContextCandidate[] = [];
  b.inScene.slice(-40).forEach((r, i) => out.push({ id: `know:scene:${r.id ?? i}`, tier: "canon", text: `${narratorName} ${label(r)}: ${r.claim}`, source: "character knowledge", authority: "AI_INFERENCE", establishedAt: null, relevance: 0.9 }));
  b.hindsightOnly.slice(-20).forEach((r, i) => out.push({ id: `know:hindsight:${r.id ?? i}`, tier: "canon", text: `HINDSIGHT ONLY (the narrator learned this later; may reflect on it from the telling time, but must not act on it in this scene): ${r.claim}`, source: "character knowledge", authority: "AI_INFERENCE", establishedAt: null, relevance: 0.8 }));
  if (b.unknown.length || b.uncertain.length) out.push({ id: "know:boundary", tier: "canon", text: `${narratorName} does NOT yet know ${b.unknown.length + b.uncertain.length} later discoveries. Do not narrate them as known; speculation is allowed only as speculation.`, source: "character knowledge", authority: "AI_INFERENCE", establishedAt: null, relevance: 0.85 });
  return out;
}

// ── Safeguard 2: deterministic checks block only demonstrable impossibilities ──
export interface LifeRecord { name: string; aliases?: string[]; birth?: ApproximateDate | null; death?: ApproximateDate | null }

const inDialogue = (text: string, idx: number) => {
  const ls = text.lastIndexOf("\n", idx) + 1;
  return ((text.slice(ls, idx).match(/["“”]/g) ?? []).length % 2) === 1;
};
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Stated ages in narration that cannot fit the character's canonical birth date at a known
 * scene date. Ages inside dialogue may be lies or mistakes → advisory only. Uncertain dates never block.
 */
export function ageFindings(text: string, people: LifeRecord[], sceneDate: ApproximateDate | null): Finding[] {
  if (!toInterval(sceneDate)) return [];
  const out: Finding[] = [];
  for (const p of people) {
    if (!p.birth) continue;
    for (const n of [p.name, ...(p.aliases ?? [])].filter((x) => x && x.trim().length > 1)) {
      const re = new RegExp(`\\b${esc(n)}\\b[^.!?\\n]{0,40}?\\b(?:was|is|turned|aged)\\s+(\\d{1,3})\\b|\\b(\\d{1,3})-year-old\\s+${esc(n)}\\b`, "gi");
      for (const m of text.matchAll(re)) {
        const stated = Number(m[1] ?? m[2]); const r = ageAt(p.birth, sceneDate);
        if (!r.known || (stated >= r.minAge && stated <= r.maxAge)) continue;
        const dialogue = inDialogue(text, m.index ?? 0);
        const definite = r.exact || stated < r.minAge - 1 || stated > r.maxAge + 1;
        const blocking = !dialogue && definite;
        out.push({ code: blocking ? "AGE_IMPOSSIBLE" : "AGE_QUESTIONABLE", category: blocking ? "continuity" : "epistemic", severity: blocking ? "material" : "minor",
          canonKind: blocking ? "timeline" : undefined, repairable: !blocking, excerpt: m[0].slice(0, 200),
          message: `${p.name} would be ${r.minAge === r.maxAge ? r.minAge : `${r.minAge}–${r.maxAge}`} at this scene's date, not ${stated}.${dialogue ? " Spoken in dialogue — may be deliberate; review." : ""}` });
      }
    }
  }
  return out;
}

/** A dated scene after a character's established death, with that character acting in narration. */
export function postDeathFindings(text: string, people: LifeRecord[], sceneDate: ApproximateDate | null): Finding[] {
  const sc = toInterval(sceneDate); if (!sc) return [];
  const out: Finding[] = [];
  for (const p of people) {
    const d = toInterval(p.death ?? null); if (!d) continue;
    const after = sc.earliest.year > d.latest.year || (sc.earliest.year === d.latest.year && (sc.earliest.month > d.latest.month || (sc.earliest.month === d.latest.month && sc.earliest.day > d.latest.day)));
    if (!after) continue;
    const re = new RegExp(`\\b${esc(p.name)}\\b\\s+(?:said|says|walked|walks|smiled|smiles|nodded|nods|replied|replies|arrived|arrives|laughed|laughs)\\b`, "i");
    const m = text.match(re);
    if (m && !inDialogue(text, m.index ?? 0)) out.push({ code: "ACTS_AFTER_DEATH", category: "continuity", severity: "material", canonKind: "timeline", repairable: false, excerpt: m[0],
      message: `${p.name} died before this scene's date but acts in it. If this is a memory, ghost or flashback, mark the scene's date or approve the change.` });
  }
  return out;
}

// ── Safeguard 3: semantic secret disclosure ─────────────────────────────────
/** A protected term in prose is a note for the author, never a block — foreshadowing stays possible. */
export function secretTermNotes(text: string, secrets: string[]): Finding[] {
  const t = text.toLowerCase();
  const hit = secrets.map((x) => x.trim()).filter((x) => x.length >= 4 && t.includes(x.toLowerCase()));
  return hit.length ? [{ code: "SECRET_TERM_PRESENT", category: "deterministic", severity: "minor", message: "A protected term appears before its reveal. Fine as foreshadowing; check it doesn't give the twist away.", excerpt: hit[0], repairable: false }] : [];
}

export interface EvalNarration {
  vantage: NarrativeVantage; firstPerson: boolean; narratorName: string | null;
  inScene: string[]; hindsightOnly: string[]; notYetKnown: string[];
}

/** Turns semantic disclosure/epistemic verdicts into findings. Only definite + verbatim-excerpt blocks. */
export function parseEpistemic(o: Row, draft: string): Finding[] {
  const out: Finding[] = [];
  const verified = (e: unknown) => typeof e === "string" && e.trim().length >= 8 && draft.includes(e.trim());
  for (const d of Array.isArray(o?.disclosures) ? o.disclosures : []) {
    if (d?.disclosed !== true) continue;
    const ex = typeof d.excerpt === "string" ? d.excerpt.trim().slice(0, 300) : "";
    const definite = d.certainty === "definite" && verified(ex);
    out.push({ code: definite ? "SECRET_LEAK" : "SECRET_POSSIBLE_LEAK", category: definite ? "continuity" : "epistemic", severity: definite ? "material" : "minor",
      canonKind: definite ? "canon" : undefined, repairable: !definite, excerpt: ex || undefined,
      message: definite ? "This passage reveals a planned twist before its chapter." : "This passage may hint too strongly at a planned twist." });
  }
  for (const e of Array.isArray(o?.epistemic) ? o.epistemic : []) {
    const kind = e?.kind === "pov_violation" ? "POV_VIOLATION" : e?.kind === "premature_knowledge" ? "PREMATURE_KNOWLEDGE" : null;
    if (!kind) continue;
    const ex = typeof e.excerpt === "string" ? e.excerpt.trim().slice(0, 300) : "";
    const definite = e.certainty === "definite" && verified(ex) && e.device !== true;
    out.push({ code: kind, category: definite ? "continuity" : "epistemic", severity: definite ? "material" : "minor", canonKind: definite ? "fact" : undefined,
      repairable: !definite, excerpt: ex || undefined,
      message: typeof e.message === "string" && e.message.trim() ? e.message.trim().slice(0, 300) : kind === "POV_VIOLATION" ? "The narrator states another character's private thoughts as fact." : "The narrator uses knowledge they have not acquired yet." });
  }
  return out;
}
