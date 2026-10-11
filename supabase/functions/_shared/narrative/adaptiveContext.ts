// Phase 2A: pure, opt-in context assembly. No database, model, identity resolution,
// extraction, or generation calls. Callers supply already sourced context candidates.
import { toPosition, type StoryPosition } from "./rules.ts";

export type ContextProfileId = "narrative" | "practical" | "life" | "technical" | "format";
export type ContextTier = "canon" | "entities" | "artifacts" | "recent" | "historical";

export interface ContextProfile {
  id: ContextProfileId;
  bookTypes: readonly string[];
  /** Preferred maxima, not minimums or guaranteed allocations. */
  tierWords: Readonly<Record<ContextTier, number>>;
  priorities: readonly ContextTier[];
  facets: readonly string[];
}

export const HARD_CONTEXT_WORD_LIMIT = 10_000;

// Data rather than branching policy: new catalog types can be assigned by adding
// a bookTypes entry; callers may pass an alternate set of profiles.
export const CONTEXT_PROFILES: readonly ContextProfile[] = [
  { id: "narrative", bookTypes: ["novel", "fiction-serial", "short-story", "children", "comic"], tierWords: { canon: 1300, entities: 1300, artifacts: 200, recent: 5500, historical: 1200 }, priorities: ["canon", "entities", "artifacts", "recent", "historical"], facets: ["characters", "relationships", "plot", "timeline"] },
  { id: "practical", bookTypes: ["self-help", "business", "finance"], tierWords: { canon: 1600, entities: 1000, artifacts: 1700, recent: 1300, historical: 1400 }, priorities: ["canon", "entities", "artifacts", "recent", "historical"], facets: ["frameworks", "definitions", "claims", "reader-knowledge", "case-studies"] },
  { id: "life", bookTypes: ["biography", "memoir"], tierWords: { canon: 1400, entities: 1300, artifacts: 300, recent: 3200, historical: 1500 }, priorities: ["canon", "entities", "artifacts", "recent", "historical"], facets: ["milestones", "relationships", "chronology", "places"] },
  { id: "technical", bookTypes: ["technology", "programming", "ai-ml", "science-popular", "reference", "textbook"], tierWords: { canon: 1600, entities: 500, artifacts: 2400, recent: 2100, historical: 1300 }, priorities: ["canon", "artifacts", "entities", "recent", "historical"], facets: ["prerequisites", "definitions", "versions", "code", "apis"] },
  { id: "format", bookTypes: ["drama", "poetry", "cookbook", "magazine", "custom"], tierWords: { canon: 1700, entities: 1100, artifacts: 1300, recent: 1600, historical: 1100 }, priorities: ["canon", "artifacts", "entities", "recent", "historical"], facets: ["format-rules", "units", "beats", "schemas", "character-continuity"] },
];

export function profileForBookType(bookType: string, profiles: readonly ContextProfile[] = CONTEXT_PROFILES): ContextProfile {
  const profile = profiles.find((p) => p.bookTypes.includes(bookType));
  if (!profile) throw new Error(`Unassigned book type: ${bookType}`);
  return profile;
}

export interface ContextCandidate {
  id: string;
  tier: ContextTier;
  text: string;
  /** Explicit provenance; no unsourced passages are accepted. */
  source: string;
  /** null is permitted only for pre-book canon, never for prose or retrieved history. */
  establishedAt: StoryPosition | null;
  authority: string;
  relevance: number;
  /** Historical passages require an explicit need (not a similarity-only match). */
  needIds?: readonly string[];
}

export interface AdaptiveContextRequest {
  bookType: string;
  position: StoryPosition;
  objective: string;
  candidates: readonly ContextCandidate[];
  historicalNeedIds?: readonly string[];
  profiles?: readonly ContextProfile[];
  hardLimitWords?: number;
}

export interface AssembledContext {
  profileId: ContextProfileId;
  facets: readonly string[];
  text: string;
  wordCount: number;
  hardLimitWords: number;
  included: { id: string; tier: ContextTier; source: string; establishedAt: StoryPosition | null; words: number }[];
  omitted: { id: string; reason: "future_or_current" | "missing_provenance" | "no_specific_need" | "tier_budget" | "hard_limit" | "duplicate" | "invalid" }[];
}

export const countContextWords = (text: string): number => text.trim().match(/\S+/g)?.length ?? 0;

export function assembleAdaptiveContext(request: AdaptiveContextRequest): AssembledContext {
  const profile = profileForBookType(request.bookType, request.profiles);
  const limit = request.hardLimitWords ?? HARD_CONTEXT_WORD_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > HARD_CONTEXT_WORD_LIMIT) throw new Error("Invalid context word limit");
  if (!Number.isSafeInteger(request.position.chapterIndex) || request.position.chapterIndex < 0 || !Number.isSafeInteger(request.position.subsectionIndex) || request.position.subsectionIndex < 0 || request.position.subsectionIndex >= 10000) throw new Error("Invalid target position");
  if (!request.objective.trim()) throw new Error("Section objective is required");
  const header = `[ADAPTIVE_CONTEXT profile=${profile.id} before=${request.position.chapterIndex}:${request.position.subsectionIndex}]\n[IMMEDIATE_OBJECTIVE] ${request.objective.trim()}\n`;
  const footer = "[/ADAPTIVE_CONTEXT]";
  if (countContextWords(header + footer) > limit) throw new Error("Section objective exceeds context limit");

  const omitted: AssembledContext["omitted"] = [];
  const included: AssembledContext["included"] = [];
  const selected = new Set<string>();
  const needs = new Set(request.historicalNeedIds ?? []);
  const current = toPosition(request.position);
  const valid: ContextCandidate[] = [];
  for (const c of request.candidates) {
    if (!c.id?.trim() || !c.text?.trim() || !profile.priorities.includes(c.tier) || !Number.isFinite(c.relevance) || c.relevance < 0 || c.relevance > 1 || (c.establishedAt !== null && (!Number.isSafeInteger(c.establishedAt?.chapterIndex) || !Number.isSafeInteger(c.establishedAt?.subsectionIndex) || c.establishedAt.chapterIndex < 0 || c.establishedAt.subsectionIndex < 0 || c.establishedAt.subsectionIndex >= 10000))) { omitted.push({ id: c.id, reason: "invalid" }); continue; }
    if (!c.source?.trim() || !c.authority?.trim() || (c.establishedAt === null && c.tier !== "canon")) { omitted.push({ id: c.id, reason: "missing_provenance" }); continue; }
    if (c.establishedAt !== null && toPosition(c.establishedAt) >= current) { omitted.push({ id: c.id, reason: "future_or_current" }); continue; }
    if (c.tier === "historical" && !c.needIds?.some((need) => needs.has(need))) { omitted.push({ id: c.id, reason: "no_specific_need" }); continue; }
    valid.push(c);
  }

  let text = header;
  let words = countContextWords(header + footer);
  for (const tier of profile.priorities) {
    const budget = profile.tierWords[tier];
    if (!Number.isSafeInteger(budget) || budget < 0) throw new Error(`Invalid tier budget: ${tier}`);
    let tierUsed = 0;
    const candidates = valid.filter((c) => c.tier === tier).sort((a, b) => b.relevance - a.relevance || a.id.localeCompare(b.id));
    for (const c of candidates) {
      if (selected.has(c.id)) { omitted.push({ id: c.id, reason: "duplicate" }); continue; }
      selected.add(c.id);
      const source = c.source.trim().replace(/\s+/g, " ");
      const authority = c.authority.trim().replace(/\s+/g, " ");
      const line = `[${tier} id=${c.id} source=${source} authority=${authority} at=${c.establishedAt ? `${c.establishedAt.chapterIndex}:${c.establishedAt.subsectionIndex}` : "pre-book"}]\n${c.text.trim()}\n`;
      const cost = countContextWords(line);
      if (tierUsed + cost > budget) { omitted.push({ id: c.id, reason: "tier_budget" }); continue; }
      if (words + cost > limit) { omitted.push({ id: c.id, reason: "hard_limit" }); continue; }
      text += line;
      tierUsed += cost;
      words += cost;
      included.push({ id: c.id, tier, source: c.source, establishedAt: c.establishedAt, words: cost });
    }
  }
  text += footer;
  return { profileId: profile.id, facets: profile.facets, text, wordCount: countContextWords(text), hardLimitWords: limit, included, omitted };
}