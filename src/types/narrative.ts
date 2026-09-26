// Narrative Engine domain types (Pass 1). Model-neutral.
import type { CharacterReference } from "./book";

export type Authority = "USER_CANON" | "OUTLINE_CANON" | "APPROVED_GENERATED_STATE" | "AI_INFERENCE";
export const AUTHORITY_RANK: Record<Authority, number> = {
  USER_CANON: 4,
  OUTLINE_CANON: 3,
  APPROVED_GENERATED_STATE: 2,
  AI_INFERENCE: 1,
};

export interface StoryPosition { chapterIndex: number; subsectionIndex: number }
export const toPosition = (p: StoryPosition) => p.chapterIndex * 10000 + p.subsectionIndex;

export interface StoryCharacter {
  id: string; book_id: string; user_id: string; source_key: string | null;
  name: string; aliases: string[]; role: string | null; is_active: boolean;
}

export type EntityType = "location" | "organization" | "object" | "faction" | "other";
export interface StoryEntity {
  id: string; book_id: string; source_key: string | null; entity_type: EntityType;
  name: string; description: string | null; aliases: string[]; attributes: Record<string, unknown>;
  first_chapter_index: number | null; first_subsection_index: number | null; is_active: boolean;
}

export interface CharacterState {
  id: string; book_id: string; character_id: string;
  chapter_index: number; subsection_index: number; position: number;
  location_entity_id: string | null; location_text: string | null;
  physical_condition: string | null; emotional_state: string | null;
  current_goals: string[]; current_motivations: string | null;
  knowledge: string[]; beliefs: Record<string, unknown>; secrets_known: string[];
  relationships: Record<string, unknown>; inventory: string[];
  key_changes: string | null; authority: Authority; version: number;
  is_current: boolean; superseded_by: string | null;
}

/** Static profile (outline) + dynamic state at a point in the story. */
export interface DynamicCharacterView {
  character: StoryCharacter;
  profile: CharacterReference | null;
  state: CharacterState | null;
}

export interface NarrativeEvent {
  id: string; book_id: string; chapter_index: number; subsection_index: number; position: number;
  chronological_order: number | null; title: string; summary: string;
  location_entity_id: string | null; location_text: string | null;
  causes: string[]; consequences: string[];
  information_revealed: string[]; information_withheld: string[];
  is_canonical: boolean; authority: Authority;
  source_subsection_id: string | null; prose_excerpt: string | null;
}

export type PlotThreadStatus = "OPEN" | "DEVELOPING" | "RESOLVED" | "ABANDONED" | "SUPERSEDED";
export interface PlotThread {
  id: string; book_id: string; source_key: string | null; title: string; description: string | null;
  introduced_chapter_index: number | null; introduced_subsection_index: number | null;
  status: PlotThreadStatus; importance: "major" | "minor";
  clues: string[]; setup_promise: string | null; required_resolution: string | null;
  resolution_event_id: string | null; resolved_chapter_index: number | null;
  resolution_notes: string | null; superseded_by: string | null;
  unresolved_questions: string[]; authority: Authority;
}

export type FactCategory = "character" | "world" | "plot" | "timeline" | "general";
export type FactConflictStatus = "clean" | "disputed" | "rejected" | "superseded";
export type FactSourceType = "user" | "outline" | "generated_prose" | "extraction" | "other";
export interface CanonicalFact {
  id: string; book_id: string; subject: string;
  subject_character_id: string | null; subject_entity_id: string | null;
  predicate: string; value: string; category: FactCategory;
  authority: Authority; source_type: FactSourceType;
  source_chapter_index: number | null; source_subsection_index: number | null;
  source_excerpt: string | null; confidence: number; is_canonical: boolean;
  conflict_status: FactConflictStatus; conflicting_fact_id: string | null; notes: string | null;
  created_at: string; updated_at: string;
}

export interface TimelineEntry {
  id: string; book_id: string; event_id: string | null;
  story_date: string | null; story_time: string | null; relative_order: number;
  chapter_index: number | null; subsection_index: number | null;
  location_entity_id: string | null; location_text: string | null;
  participant_ids: string[]; event_summary: string; duration: string | null; is_flashback: boolean;
}

export interface StoryStateSnapshot {
  id: string; book_id: string; chapter_index: number; subsection_index: number;
  scope: "subsection" | "chapter"; narrative_summary: string | null;
  timeline_position: number | null; state: Record<string, unknown>; version: number;
}

/** Answer to "what was true at position X?" */
export interface StoryStateAtPosition {
  position: StoryPosition;
  characters: DynamicCharacterView[];
  openThreads: PlotThread[];
  recentEvents: NarrativeEvent[];
  facts: CanonicalFact[];
  disputedFacts: CanonicalFact[];
  timelinePosition: TimelineEntry | null;
  latestSnapshot: StoryStateSnapshot | null;
}
