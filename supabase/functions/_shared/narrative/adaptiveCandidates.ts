// Phase 2D: pure bridge from existing story memory + saved sections to Phase 2A candidates.
// No I/O. Every candidate carries provenance and a position strictly before the target;
// assembleAdaptiveContext enforces the same rule again (defence in depth).
import { selectNarrativeState, type NarrativeRows, type OutlineCharacter } from "./context.ts";
import { assembleAdaptiveContext, countContextWords, profileForBookType, type AssembledContext, type ContextCandidate } from "./adaptiveContext.ts";
import { toPosition, type StoryPosition } from "./rules.ts";
import { parseReplacements, replacementTag } from "./deprecations.ts";
import { castKey, castStatus, plannedDebuts } from "./cast.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export type ContextEngine = "legacy" | "adaptive";
/** Missing or unknown values always mean legacy: existing books are never switched implicitly. */
export const resolveContextEngine = (controls: unknown): ContextEngine =>
  (controls as Row | null)?.context_engine === "adaptive" ? "adaptive" : "legacy";

const ARTIFACT_TYPES = new Set(["framework", "definition", "claim", "artifact", "recipe", "concept", "api", "code", "version", "metric"]);
const authorityRelevance: Record<string, number> = { USER_CANON: 1, OUTLINE_CANON: 0.95, APPROVED_GENERATED_STATE: 0.85, AI_INFERENCE: 0.6 };

const tailWords = (text: string, max: number): string => {
  const words = text.trim().split(/\s+/);
  if (words.length <= max) return text.trim();
  const tail = words.slice(-max).join(" ");
  const cut = tail.search(/[.!?]["')\]]?\s/); // start at a sentence boundary
  return cut > 0 && cut < tail.length / 3 ? tail.slice(cut + 1).trim() : tail;
};

export interface AdaptiveInput {
  bookType: string;
  position: StoryPosition;
  objective: string;
  outline: Row | null;
  rows: NarrativeRows;
  identityEntities?: Row[];
}

export function buildAdaptiveCandidates(input: AdaptiveInput): { candidates: ContextCandidate[]; needIds: string[] } {
  const { position, outline, rows } = input;
  const profile = profileForBookType(input.bookType);
  const current = toPosition(position);
  const out: ContextCandidate[] = [];
  const cast = (outline?.characters ?? []) as OutlineCharacter[];
  const state = selectNarrativeState(rows, position, cast, outline?.chapters ?? []);
  // Planned cast is outline canon, but only characters whose planned debut is at or before the
  // target are eligible for this scene; later debuts are withheld (no early appearances).
  const debuts = plannedDebuts(cast as Row[], outline?.chapters ?? []);
  const withheld = new Set<string>();
  const evidenced = new Set(state.characters.filter((c) => c.state).map((c) => c.name));

  // Canon: outline-level characters (pre-book) + clean canonical facts known before the target.
  for (const c of cast) {
    if (!c?.name) continue;
    const status = evidenced.has(c.name) ? "established" : castStatus(debuts.get(castKey(c)), position);
    if (status === "future") { withheld.add(c.name.toLowerCase()); continue; }
    const tag = status === "enters_now" ? " [planned to first appear in THIS section]" : status === "unplaced" ? " [planned cast; not yet on page]" : "";
    const text = [c.name + tag, c.role, c.description].filter(Boolean).join(" — ");
    out.push({ id: `outline-char:${c.id ?? c.name}`, tier: "canon", text, source: "outline", authority: "OUTLINE_CANON", establishedAt: null, relevance: 0.9 });
  }
  for (const f of state.facts) {
    const at = typeof f.source_chapter_index === "number" ? { chapterIndex: f.source_chapter_index, subsectionIndex: f.source_subsection_index ?? 0 } : null;
    out.push({ id: `fact:${f.id}`, tier: "canon", text: `${f.subject} ${f.predicate} ${f.value}`, source: at ? `section ${at.chapterIndex}:${at.subsectionIndex}` : `fact:${f.source_type ?? "user"}`, authority: f.authority ?? "AI_INFERENCE", establishedAt: at ?? (f.authority === "USER_CANON" || f.authority === "OUTLINE_CANON" ? null : position), relevance: authorityRelevance[f.authority] ?? 0.6 });
  }

  // Entities: characters with point-in-time state, identity registry, story entities.
  for (const ch of state.characters) {
    const s = ch.state;
    const bits = [ch.role, s?.location && `at ${s.location}`, s?.emotional, s?.physical, s?.goals.length ? `goals: ${s.goals.join("; ")}` : null,
      s && Object.keys(s.relationships).length ? `relationships: ${Object.entries(s.relationships).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join("; ")}` : null].filter(Boolean);
    const at = s?.asOf ?? null;
    if (!at) continue; // stateless characters are already covered by outline canon
    out.push({ id: `char:${ch.id}`, tier: "entities", text: `${ch.name}: ${bits.join(", ")}`, source: `state ${at.chapterIndex}:${at.subsectionIndex}`, authority: "APPROVED_GENERATED_STATE", establishedAt: at, relevance: 0.85 });
  }
  for (const e of input.identityEntities ?? []) {
    const p = Number(e.introduced_position);
    if (!Number.isFinite(p) || p >= current) continue;
    if ([e.name, ...(e.aliases ?? [])].some((n: unknown) => typeof n === "string" && withheld.has(n.toLowerCase()))) continue; // planned later debut
    const at = { chapterIndex: Math.floor(p / 10000), subsectionIndex: p % 10000 };
    const tier = ARTIFACT_TYPES.has(String(e.kind)) ? "artifacts" : "entities";
    out.push({ id: `identity:${e.id}`, tier, text: `${e.name} (${e.kind})${e.aliases?.length ? `, also: ${e.aliases.join(", ")}` : ""}`, source: "identity registry", authority: "APPROVED_GENERATED_STATE", establishedAt: at, relevance: 0.8 });
  }
  for (const e of state.entities) {
    if (typeof e.first_chapter_index !== "number") continue;
    const tier = ARTIFACT_TYPES.has(String(e.entity_type)) ? "artifacts" : "entities";
    out.push({ id: `entity:${e.id}`, tier, text: `${e.name} (${e.entity_type})${e.description ? `: ${e.description}` : ""}`, source: `section ${e.first_chapter_index}:${e.first_subsection_index ?? 0}`, authority: "APPROVED_GENERATED_STATE", establishedAt: { chapterIndex: e.first_chapter_index, subsectionIndex: e.first_subsection_index ?? 0 }, relevance: 0.75 });
  }

  // Replaced artifacts: keep the history but mark the legacy name unmistakably, highest artifact relevance.
  const visibleArtifacts = state.entities.filter((e) => typeof e.first_chapter_index === "number" && ARTIFACT_TYPES.has(String(e.entity_type)));
  for (const r of parseReplacements(visibleArtifacts.map((e) => ({ name: e.name, description: e.description, source: `section ${e.first_chapter_index}:${e.first_subsection_index ?? 0}` })))) {
    const src = visibleArtifacts.find((e) => e.name.replace(/\(\)$/, "") === r.active) ?? visibleArtifacts[0];
    out.push({ id: `replaced:${r.legacy}`, tier: "artifacts", text: replacementTag(r), source: r.source, authority: "APPROVED_GENERATED_STATE", establishedAt: { chapterIndex: src.first_chapter_index, subsectionIndex: src.first_subsection_index ?? 0 }, relevance: 1 });
  }

  // Recent prose: saved sections strictly before the target, newest first, tail-limited to the tier budget.
  const prior: { at: StoryPosition; title: string; content: string }[] = [];
  (outline?.chapters ?? []).forEach((ch: Row, ci: number) => (ch?.subsections ?? []).forEach((s: Row, si: number) => {
    const at = { chapterIndex: ci, subsectionIndex: si };
    if (typeof s?.content === "string" && s.content.trim() && toPosition(at) < current) prior.push({ at, title: s.title ?? "", content: s.content });
  }));
  prior.sort((a, b) => toPosition(b.at) - toPosition(a.at));
  let remaining = profile.tierWords.recent;
  prior.slice(0, 4).forEach((p, i) => {
    const allowance = remaining - 25; // room for the provenance line
    if (allowance < 60) return;
    const text = tailWords(p.content, allowance);
    remaining -= countContextWords(text) + 20;
    out.push({ id: `prose:${p.at.chapterIndex}:${p.at.subsectionIndex}`, tier: "recent", text, source: `section ${p.at.chapterIndex}:${p.at.subsectionIndex}${p.title ? ` ${p.title}` : ""}`, authority: "APPROVED_GENERATED_STATE", establishedAt: p.at, relevance: 1 - i * 0.1 });
  });

  // Historical: only events tied to an active thread (an explicit need), never similarity alone.
  const needIds = state.activeThreads.map((t) => `thread:${t.id}`);
  const linked = new Map<string, string[]>();
  for (const l of rows.threadEvents) if (needIds.includes(`thread:${l.thread_id}`)) linked.set(l.event_id, [...(linked.get(l.event_id) ?? []), `thread:${l.thread_id}`]);
  for (const e of state.earlierEvents) {
    const ev = rows.events.find((r) => r.title === e.title && r.summary === e.summary);
    const needs = ev ? linked.get(ev.id) : undefined;
    if (!needs?.length) continue;
    out.push({ id: `event:${ev!.id}`, tier: "historical", text: `${e.title}: ${e.summary}`, source: `section ${e.pos.chapterIndex}:${e.pos.subsectionIndex}`, authority: ev!.authority ?? "APPROVED_GENERATED_STATE", establishedAt: e.pos, relevance: 0.7, needIds: needs });
  }
  for (const e of state.recentEvents) {
    out.push({ id: `recent-event:${e.pos.chapterIndex}:${e.pos.subsectionIndex}:${e.title}`, tier: "recent", text: `${e.title}: ${e.summary}`, source: `section ${e.pos.chapterIndex}:${e.pos.subsectionIndex}`, authority: "APPROVED_GENERATED_STATE", establishedAt: e.pos, relevance: 0.6 });
  }
  for (const t of state.activeThreads) {
    out.push({ id: `thread:${t.id}`, tier: "canon", text: `Open thread — ${t.title}${t.setupPromise ? `: ${t.setupPromise}` : ""}`, source: "plot threads", authority: "APPROVED_GENERATED_STATE", establishedAt: null, relevance: t.importance === "major" ? 0.9 : 0.7 });
  }
  return { candidates: out, needIds };
}

export interface AdaptiveBuild { context: AssembledContext; candidateCount: number }

/** Full adaptive build. Throws only on invalid input; callers fall back to legacy on any error. */
export function buildAdaptiveContext(input: AdaptiveInput): AdaptiveBuild {
  const { candidates, needIds } = buildAdaptiveCandidates(input);
  // Thread rows carry null position; they are canon-tier summaries, never prose, so allow them.
  const context = assembleAdaptiveContext({ bookType: input.bookType, position: input.position, objective: input.objective, candidates, historicalNeedIds: needIds });
  return { context, candidateCount: candidates.length };
}
