// Style Diversity / Anti-Template Layer (pure, deterministic; shared by browser, backend and tests).
// Detects rhetorical pattern FAMILIES (not single banned strings) and plans a varied opening
// strategy per section. The ledger is derived from the book's saved sections, so regenerating
// a section automatically "undoes" its entry — no separate state to drift.

export type OpeningStrategy =
  | "anecdote" | "contrarian_claim" | "concrete_scene" | "question" | "statistic"
  | "direct_instruction" | "historical_observation" | "problem_statement" | "unexpected_comparison"
  | "short_dialogue" | "case_study" | "consequence_first" | "definition" | "paradox" | "sensory_moment";

export const STRATEGY_INSTRUCTIONS: Record<OpeningStrategy, string> = {
  anecdote: "Open with a brief, specific anecdote already in motion.",
  contrarian_claim: "Open with a clear claim that challenges a common assumption, then support it.",
  concrete_scene: "Open inside a concrete scene: a place, a person, an action.",
  question: "Open with one sharp, specific question the section answers (not a vague rhetorical one).",
  statistic: "Open with a precise figure or measurable fact taken only from the material provided; if none is available, use a problem statement instead. Never invent numbers.",
  direct_instruction: "Open with a direct instruction or action the reader can take.",
  historical_observation: "Open with a specific historical moment or precedent relevant to the subject.",
  problem_statement: "Open by naming the exact problem or decision the reader faces.",
  unexpected_comparison: "Open with an unexpected but apt comparison that clarifies the idea.",
  short_dialogue: "Open with a short exchange of dialogue.",
  case_study: "Open with a named, specific case (one person or organisation) that anchors the section; do not introduce several unrelated people.",
  consequence_first: "Open with the outcome or consequence, then show how it came about.",
  definition: "Open by defining a key term precisely and why it matters here.",
  paradox: "Open with a genuine tension or paradox at the heart of the section.",
  sensory_moment: "Open with one precise sensory detail grounded in the moment.",
};
export const OPENING_STRATEGIES = Object.keys(STRATEGY_INSTRUCTIONS) as OpeningStrategy[];

const NARRATIVE: OpeningStrategy[] = ["concrete_scene", "short_dialogue", "sensory_moment", "consequence_first", "anecdote", "paradox", "question"];
const PRACTICAL: OpeningStrategy[] = ["problem_statement", "contrarian_claim", "case_study", "statistic", "direct_instruction", "question", "anecdote", "consequence_first", "unexpected_comparison", "paradox", "definition", "historical_observation"];
const TECHNICAL: OpeningStrategy[] = ["problem_statement", "question", "definition", "direct_instruction", "case_study", "unexpected_comparison", "historical_observation", "consequence_first", "statistic"];
const LIFE: OpeningStrategy[] = ["concrete_scene", "anecdote", "sensory_moment", "historical_observation", "short_dialogue", "consequence_first", "paradox"];

/** Allowed strategies per book type. Format-constrained types get format-safe sets only. */
export function allowedStrategies(bookType: string): OpeningStrategy[] {
  switch (bookType) {
    case "novel": case "fiction-serial": case "short-story": case "children": return NARRATIVE;
    case "comic": return ["concrete_scene", "short_dialogue", "sensory_moment", "consequence_first"];
    case "drama": return ["concrete_scene", "short_dialogue", "consequence_first"];
    case "poetry": return ["sensory_moment", "paradox", "unexpected_comparison", "question"];
    case "cookbook": return ["sensory_moment", "direct_instruction", "anecdote", "historical_observation", "problem_statement"];
    case "biography": case "memoir": return LIFE;
    case "self-help": case "business": case "finance": return PRACTICAL;
    case "magazine": return ["anecdote", "contrarian_claim", "case_study", "question", "concrete_scene", "statistic", "consequence_first"];
    default: return TECHNICAL;
  }
}

/** Writer leanings — first match in the allowed set wins ties. Unknown writers use the type order. */
export const WRITER_PREFERENCES: Record<string, OpeningStrategy[]> = {
  claire: ["statistic", "problem_statement", "contrarian_claim", "case_study"],
  maya: ["case_study", "contrarian_claim", "problem_statement", "direct_instruction"],
  marcus: ["contrarian_claim", "direct_instruction", "consequence_first", "paradox"],
  priya: ["question", "definition", "unexpected_comparison", "problem_statement"],
  daniel: ["historical_observation", "case_study", "paradox", "question"],
  ethan: ["problem_statement", "direct_instruction", "definition", "question"],
  sophia: ["anecdote", "question", "sensory_moment", "paradox"],
  elena: ["sensory_moment", "concrete_scene", "short_dialogue", "paradox"],
  julian: ["concrete_scene", "consequence_first", "short_dialogue", "historical_observation"],
  adrian: ["short_dialogue", "consequence_first", "concrete_scene", "contrarian_claim"],
  nora: ["concrete_scene", "short_dialogue", "sensory_moment", "question"],
  luca: ["sensory_moment", "anecdote", "direct_instruction", "historical_observation"],
};

// ── Pattern families ──
export type PatternFamily = "general_observation" | "universal_we" | "superlative_frame" | "imagine_frame" | "stock_transition" | "rhetorical_question_run" | "triad_list";

const OPENER_FAMILIES: [PatternFamily, RegExp][] = [
  ["general_observation", /^(there'?s|there is|there are|there was)\s+(a|an|one|this|that)\s+(particular|certain|specific|special|peculiar|strange|unique|quiet)?\s*(kind|type|sort|moment|feeling|silence|brand|flavou?r|breed)\b/i],
  ["general_observation", /^there'?s\s+a\s+moment\s+(in|when)\b/i],
  ["general_observation", /^some\s+\w+(\s+\w+)?\s+have\s+a\s+way\s+of\b/i],
  ["general_observation", /^(some|many|most)\s+(people|things|problems|days|moments|decisions|lessons)\b/i],
  ["universal_we", /^(we'?ve all|we have all|we all|all of us|everyone has|everybody has|most of us)\b/i],
  ["superlative_frame", /^(few things are|nothing is more|one of the (most|biggest|greatest|hardest)|perhaps the most)\b/i],
  ["imagine_frame", /^(imagine|picture this|picture a|think about|consider this)\b/i],
  ["stock_transition", /^(in today'?s|in a world where|the truth is|here'?s the thing|let'?s be honest)\b/i],
];

export const STOCK_PHRASES: string[] = [
  "the truth is", "but here's the thing", "here's the thing", "let's take a closer look", "in today's world",
  "in today's fast-paced", "at the end of the day", "it's no secret that", "the reality is", "make no mistake",
  "it's worth noting", "let that sink in", "game-changer", "imagine a world",
];

const norm = (s: string) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, " ").trim();
const stripTags = (s: string) => s.replace(/<[^>]+>/g, " ");

export function firstSentence(text: string): string {
  const t = norm(stripTags(text ?? ""));
  const m = t.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (m ? m[0] : t).slice(0, 300);
}

/** Pattern family of an opening sentence, or null if it doesn't match a known template. */
export function openingFamily(text: string): PatternFamily | null {
  const s = firstSentence(text).replace(/^["'(\s]+/, "");
  for (const [fam, re] of OPENER_FAMILIES) if (re.test(s)) return fam;
  return null;
}

/** Best-effort classification of an opening into one of the 15 strategies (or the template family). */
export function classifyOpening(text: string): OpeningStrategy | "general_observation" | "unknown" {
  const fam = openingFamily(text);
  if (fam === "general_observation" || fam === "universal_we" || fam === "superlative_frame") return "general_observation";
  const s = firstSentence(text);
  if (/^["'\u201C]/.test(norm(stripTags(text ?? "")))) return "short_dialogue";
  if (/\?$/.test(s)) return "question";
  if (/\b\d[\d,.]*\s*(%|percent|million|billion|thousand)?/.test(s) && /\d/.test(s)) return "statistic";
  if (/^(in|by)\s+(1[5-9]|20)\d\d\b/i.test(s)) return "historical_observation";
  if (/\b(is defined as|means|refers to)\b/i.test(s)) return "definition";
  if (/^(start|stop|write|open|take|try|pick|list|ask|begin|preheat|install|run)\b/i.test(s)) return "direct_instruction";
  return "unknown";
}

export interface PatternReport { openingFamily: PatternFamily | null; stockPhrases: string[]; rhetoricalQuestions: number; triads: number }

export function detectPatterns(text: string): PatternReport {
  const t = norm(stripTags(text ?? "")).toLowerCase();
  const stockPhrases = STOCK_PHRASES.filter((p) => t.includes(p));
  const rhetoricalQuestions = (t.match(/[^.?!]{3,140}\?/g) ?? []).length;
  const triads = (t.match(/\b[\w'-]+(?: [\w'-]+){0,2}, [\w'-]+(?: [\w'-]+){0,2},? and [\w'-]+/g) ?? []).length;
  return { openingFamily: openingFamily(text), stockPhrases, rhetoricalQuestions, triads };
}

// ── Ledger + planner ──
export interface LedgerEntry { chapterIndex: number; subsectionIndex: number; strategy: ReturnType<typeof classifyOpening>; family: PatternFamily | null; stockPhrases: string[] }

/** Ledger from the book's saved sections strictly before the target position. */
export function buildLedger(outline: unknown, before?: { chapterIndex: number; subsectionIndex: number }): LedgerEntry[] {
  const chapters = (outline as { chapters?: unknown[] })?.chapters;
  if (!Array.isArray(chapters)) return [];
  const out: LedgerEntry[] = [];
  chapters.forEach((ch: any, ci) => (ch?.subsections ?? []).forEach((s: any, si: number) => {
    if (before && (ci > before.chapterIndex || (ci === before.chapterIndex && si >= before.subsectionIndex))) return;
    const content = typeof s?.content === "string" ? s.content : "";
    if (!content.trim()) return;
    out.push({ chapterIndex: ci, subsectionIndex: si, strategy: classifyOpening(content), family: openingFamily(content), stockPhrases: detectPatterns(content).stockPhrases });
  }));
  return out;
}

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const RECENT_WINDOW = 3;

/** Deterministic strategy choice: allowed by type, ordered by writer leaning, no reuse in the last 3 sections. */
export function planOpeningStrategy(input: { bookType: string; writerId?: string | null; position: number; ledger?: LedgerEntry[]; seed?: string }): OpeningStrategy {
  const allowed = allowedStrategies(input.bookType);
  const prefs = (input.writerId && WRITER_PREFERENCES[input.writerId]) || [];
  const ordered = [...prefs.filter((p) => allowed.includes(p)), ...allowed.filter((a) => !prefs.includes(a))];
  const recent = new Set((input.ledger ?? []).slice(-RECENT_WINDOW).map((e) => e.strategy));
  const pool = ordered.filter((s) => !recent.has(s));
  const list = pool.length ? pool : ordered;
  const offset = input.seed ? hash(input.seed) : 0;
  return list[(input.position + offset) % list.length];
}

/** Dynamic-tail prompt block (never part of the cached system prefix). */
export function renderOpeningStrategyBlock(strategy: OpeningStrategy, ledger: LedgerEntry[] = []): string {
  const used = [...new Set(ledger.map((e) => e.family).filter(Boolean))] as PatternFamily[];
  const phrases = [...new Set(ledger.flatMap((e) => e.stockPhrases))].slice(0, 8);
  const lines = [`OPENING STRATEGY FOR THIS SECTION: ${strategy.replace(/_/g, " ")} — ${STRATEGY_INSTRUCTIONS[strategy]}`];
  if (used.length) lines.push(`Opening templates already used in this book (do not use any variant of them): ${used.map((f) => f.replace(/_/g, " ")).join(", ")}.`);
  if (phrases.length) lines.push(`Stock phrases already used in this book (avoid): ${phrases.map((p) => `"${p}"`).join(", ")}.`);
  lines.push("If this section continues an unfinished scene or argument, resume it naturally and apply the strategy only as far as it fits.");
  return lines.join("\n");
}

/** Book-wide repetition stats for the read-only audit. */
export function rhetoricalRepetitionStats(ledger: LedgerEntry[]) {
  const families: Record<string, number> = {}, phrases: Record<string, number> = {};
  for (const e of ledger) {
    if (e.family) families[e.family] = (families[e.family] ?? 0) + 1;
    for (const p of e.stockPhrases) phrases[p] = (phrases[p] ?? 0) + 1;
  }
  return { sections: ledger.length, families, phrases };
}
