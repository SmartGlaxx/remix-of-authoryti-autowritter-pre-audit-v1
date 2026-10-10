// Phase C genre adapters (pure data + small validators). Each adapter plugs into the
// universal progressive planning engine (engine.ts); nonfiction adapters never carry
// fiction requirements (reveals, character arcs, twists).

export type AdapterId =
  | "fiction" | "self_help" | "business" | "finance"
  | "children" | "cookbook" | "magazine" | "technical" | "narrative_nonfiction";

export interface GenreAdapter {
  id: AdapterId;
  label: string;
  /** App book types routed to this adapter. Every app book type maps to exactly one. */
  bookTypes: readonly string[];
  isFiction: boolean;
  /** Required keys in master-plan genre_data. */
  masterFields: readonly string[];
  /** Allowed chapter objective kinds (what a chapter must achieve). */
  chapterObjectives: readonly string[];
  /** Name of the section unit (scene, lesson, recipe, article, step...). */
  sectionUnit: string;
  sectionsPerChapter: { min: number; max: number; default: number };
  /** Local beat kinds, in canonical order for a section. */
  beatKinds: readonly string[];
  /** Relative chapter weight curve for word allocation (position 0..1 -> weight). */
  weight: (t: number) => number;
  /** Minimum words for any section (keeps allocation sane). */
  minSectionWords: number;
  /** True-story planning: scenes allowed, but every planned claim carries an evidence tier and nothing is invented as fact. */
  factual?: boolean;
}

const flat = () => 1;

export const GENRE_ADAPTERS: readonly GenreAdapter[] = [
  {
    id: "fiction", label: "Fiction", isFiction: true,
    bookTypes: ["novel", "fiction-serial", "short-story", "drama", "comic", "poetry"],
    masterFields: ["protagonist", "central_conflict", "stakes", "reveals"],
    chapterObjectives: ["setup", "complication", "reveal", "reversal", "climax", "resolution"],
    sectionUnit: "scene", sectionsPerChapter: { min: 2, max: 6, default: 4 },
    beatKinds: ["entry", "goal", "obstacle", "turn", "exit_hook"],
    // Slight build toward the climax, short denouement.
    weight: (t) => (t > 0.92 ? 0.8 : 0.9 + 0.3 * t), minSectionWords: 400,
  },
  {
    id: "narrative_nonfiction", label: "Biography / memoir", isFiction: false, factual: true,
    bookTypes: ["biography", "memoir"],
    masterFields: ["subject", "historical_scope", "primary_sources", "epistemic_boundaries"],
    chapterObjectives: ["context_origins", "formative_period", "catalyst", "peak_struggle", "turning_point", "aftermath_legacy"],
    sectionUnit: "scene", sectionsPerChapter: { min: 1, max: 6, default: 3 },
    beatKinds: ["scene_anchor", "documented_fact", "subject_perspective", "source_note", "reflective_meaning"],
    weight: flat, minSectionWords: 300,
  },
  {
    id: "self_help", label: "Self-help", isFiction: false,
    bookTypes: ["self-help"],
    masterFields: ["reader_problem", "transformation", "core_framework"],
    chapterObjectives: ["awareness", "principle", "practice", "obstacle", "integration"],
    sectionUnit: "lesson", sectionsPerChapter: { min: 2, max: 5, default: 3 },
    beatKinds: ["hook", "insight", "example", "exercise", "takeaway"],
    weight: flat, minSectionWords: 300,
  },
  {
    id: "business", label: "Business / leadership", isFiction: false,
    bookTypes: ["business"],
    masterFields: ["audience_role", "core_thesis", "framework"],
    chapterObjectives: ["problem", "thesis", "framework_step", "case_study", "implementation"],
    sectionUnit: "argument", sectionsPerChapter: { min: 2, max: 5, default: 3 },
    beatKinds: ["claim", "evidence", "case", "application", "takeaway"],
    weight: flat, minSectionWords: 300,
  },
  {
    id: "finance", label: "Personal finance", isFiction: false,
    bookTypes: ["finance"],
    masterFields: ["reader_situation", "financial_goal", "disclaimer_scope"],
    chapterObjectives: ["foundation", "concept", "calculation", "strategy", "risk", "action_plan"],
    sectionUnit: "topic", sectionsPerChapter: { min: 2, max: 5, default: 3 },
    beatKinds: ["situation", "concept", "worked_example", "risk_note", "action"],
    weight: flat, minSectionWords: 300,
  },
  {
    id: "children", label: "Children's books", isFiction: true,
    bookTypes: ["children"],
    masterFields: ["age_band", "protagonist", "lesson"],
    chapterObjectives: ["setup", "problem", "attempt", "resolution"],
    sectionUnit: "spread", sectionsPerChapter: { min: 1, max: 4, default: 2 },
    beatKinds: ["picture_moment", "action", "repeat_refrain", "page_turn"],
    weight: flat, minSectionWords: 60,
  },
  {
    id: "cookbook", label: "Cookbooks", isFiction: false,
    bookTypes: ["cookbook"],
    masterFields: ["cuisine", "skill_level", "unit_system"],
    chapterObjectives: ["intro", "technique", "recipe_group"],
    sectionUnit: "recipe", sectionsPerChapter: { min: 3, max: 12, default: 6 },
    beatKinds: ["headnote", "ingredients", "method", "tips"],
    weight: flat, minSectionWords: 150,
  },
  {
    id: "magazine", label: "Magazines", isFiction: false,
    bookTypes: ["magazine", "custom"],
    masterFields: ["issue_theme", "audience", "departments"],
    chapterObjectives: ["front_of_book", "feature", "department", "back_of_book"],
    sectionUnit: "article", sectionsPerChapter: { min: 1, max: 6, default: 3 },
    beatKinds: ["lede", "nut_graf", "body", "kicker"],
    // Features (middle) run longer than front/back of book.
    weight: (t) => (t < 0.15 || t > 0.85 ? 0.6 : 1.2), minSectionWords: 150,
  },
  {
    id: "technical", label: "Technical / instructional", isFiction: false,
    bookTypes: ["technology", "programming", "ai-ml", "science-popular", "reference"],
    masterFields: ["prerequisites", "learning_outcomes", "versions"],
    chapterObjectives: ["concept", "setup", "tutorial", "reference", "troubleshooting"],
    sectionUnit: "step", sectionsPerChapter: { min: 2, max: 6, default: 4 },
    beatKinds: ["objective", "explanation", "example", "check", "summary"],
    weight: flat, minSectionWords: 250,
  },
];

export function adapterForBookType(bookType: string): GenreAdapter {
  const a = GENRE_ADAPTERS.find((x) => x.bookTypes.includes(bookType));
  if (!a) throw new Error(`No planning adapter for book type: ${bookType}`);
  return a;
}

export function getAdapter(id: AdapterId): GenreAdapter {
  const a = GENRE_ADAPTERS.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown adapter: ${id}`);
  return a;
}
