// Phase 4 — Book Setup (pure). Approved setup decisions are a planning direction, never canon:
// they feed the existing master planner as planner-only guidance; twists become scheduled reveals,
// never narrator knowledge. Shared by browser, plan-book and tests.
import { adapterForBookType } from "./adapters.ts";
import { STORY_ALTERNATIVE_COUNTS, extractJson, type BookBrief, type Prompt, type StoryAlternative, type ParseResult } from "./aiPlanning.ts";
import { resolveIdentity, type KnownIdentity, type IdentityMatch } from "../identityResolution.ts";

export const SETUP_SCHEMA = 1;
export const SETUP_STAGES = ["concept", "alternatives", "twists", "cast", "narration", "planning"] as const;
export type SetupStage = typeof SETUP_STAGES[number];
export const BOOK_ROLES = ["protagonist", "antagonist", "primary_narrator", "deuteragonist", "mentor", "foil", "love_interest", "catalyst", "supporting", "minor", "ally", "rival", "viewpoint"] as const;
export type BookRole = typeof BOOK_ROLES[number];
export const POVS = ["first_person", "third_limited", "third_omniscient", "second_person"] as const;

export interface SetupTwist { id: string; text: string; status: "proposed" | "approved" | "rejected"; revealChapter: number | null; clues: string[]; authorEdited?: boolean }
export interface SetupCastMember {
  key: string; name: string; role: BookRole; identityId: string | null;
  /** Lightweight = book-only character with no Persona Studio profile. */
  lightweight: boolean; note?: string;
}
export interface SetupViewpoint { castKey: string; purpose: string; chapters: number[] }
export interface BookSetup {
  schema: number; stage: SetupStage;
  premise: string; fixedRequirements: string[];
  storyMode: "explore" | "skip";
  alternatives: StoryAlternative[]; selectedIndex: number | null;
  twistsEnabled: boolean; twists: SetupTwist[];
  perspective: "single" | "multiple"; viewpoints: SetupViewpoint[];
  cast: SetupCastMember[];
  narration: { pov: string; personaLed: boolean; narratorKey: string | null; vantage: "immediate" | "retrospective"; tellingDate: string | null };
  universeId: string | null; penNameId: string | null;
  updatedAt?: string;
}

export function emptySetup(premise = ""): BookSetup {
  return {
    schema: SETUP_SCHEMA, stage: "concept", premise, fixedRequirements: [], storyMode: "explore", alternatives: [], selectedIndex: null,
    twistsEnabled: false, twists: [], perspective: "single", viewpoints: [], cast: [],
    narration: { pov: "third_limited", personaLed: false, narratorKey: null, vantage: "immediate", tellingDate: null },
    universeId: null, penNameId: null,
  };
}

const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);
const int = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 200 ? (v as number) : null);

/** Coerces any client payload into a bounded, well-typed setup. Unknown keys are dropped. */
// deno-lint-ignore no-explicit-any
export function normalizeSetup(raw: any): BookSetup {
  const b = emptySetup();
  if (!raw || typeof raw !== "object") return b;
  const alts: StoryAlternative[] = (Array.isArray(raw.alternatives) ? raw.alternatives : []).slice(0, 10).map((a: any, i: number) => ({
    id: s(a?.id, 40) || `alt${i + 1}`, title: s(a?.title, 300), logline: s(a?.logline, 1000), summary: s(a?.summary, 8000), twist: s(a?.twist, 2000), ending: s(a?.ending, 2000),
  }));
  const cast: SetupCastMember[] = (Array.isArray(raw.cast) ? raw.cast : []).slice(0, 60).map((c: any, i: number) => ({
    key: s(c?.key, 60) || `c${i + 1}`, name: s(c?.name, 120), role: (BOOK_ROLES as readonly string[]).includes(c?.role) ? c.role : "supporting",
    identityId: uuid(c?.identityId), lightweight: c?.identityId ? false : c?.lightweight !== false, note: s(c?.note, 500) || undefined,
  })).filter((c: SetupCastMember) => c.name);
  const n = raw.narration ?? {};
  return {
    schema: SETUP_SCHEMA,
    stage: (SETUP_STAGES as readonly string[]).includes(raw.stage) ? raw.stage : "concept",
    premise: s(raw.premise, 6000),
    fixedRequirements: (Array.isArray(raw.fixedRequirements) ? raw.fixedRequirements : []).map((x: unknown) => s(x, 400)).filter(Boolean).slice(0, 20),
    storyMode: raw.storyMode === "skip" ? "skip" : "explore",
    alternatives: alts,
    selectedIndex: int(raw.selectedIndex) !== null && raw.selectedIndex < alts.length ? raw.selectedIndex : null,
    twistsEnabled: raw.twistsEnabled === true,
    twists: (Array.isArray(raw.twists) ? raw.twists : []).slice(0, 12).map((t: any, i: number) => ({
      id: s(t?.id, 40) || `t${i + 1}`, text: s(t?.text, 2000), status: ["approved", "rejected"].includes(t?.status) ? t.status : "proposed",
      revealChapter: int(t?.revealChapter), clues: (Array.isArray(t?.clues) ? t.clues : []).map((x: unknown) => s(x, 400)).filter(Boolean).slice(0, 8), authorEdited: t?.authorEdited === true || undefined,
    })).filter((t: SetupTwist) => t.text),
    perspective: raw.perspective === "multiple" ? "multiple" : "single",
    viewpoints: (Array.isArray(raw.viewpoints) ? raw.viewpoints : []).slice(0, 8).map((v: any) => ({
      castKey: s(v?.castKey, 60), purpose: s(v?.purpose, 600), chapters: (Array.isArray(v?.chapters) ? v.chapters : []).map(int).filter((x: number | null): x is number => x !== null).slice(0, 200),
    })).filter((v: SetupViewpoint) => v.castKey),
    cast,
    narration: {
      pov: (POVS as readonly string[]).includes(n.pov) ? n.pov : "third_limited", personaLed: n.personaLed === true,
      narratorKey: s(n.narratorKey, 60) || null, vantage: n.vantage === "retrospective" ? "retrospective" : "immediate", tellingDate: s(n.tellingDate, 60) || null,
    },
    universeId: uuid(raw.universeId), penNameId: uuid(raw.penNameId),
  };
}

export interface SetupIssue { code: string; message: string; blocking: boolean }

/** Server-side validation. Blocking issues stop the save; others are shown as warnings. */
export function validateSetup(st: BookSetup, ctx: { bookType: string; penNames?: { id: string; pen_name: string }[]; chapterCount?: number }): SetupIssue[] {
  const out: SetupIssue[] = [];
  const isFiction = (() => { try { return adapterForBookType(ctx.bookType).isFiction; } catch { return true; } })();
  const byKey = new Map(st.cast.map((c) => [c.key, c]));
  if (!isFiction) {
    if (st.twistsEnabled || st.twists.length) out.push({ code: "NONFICTION_TWISTS", message: "Plot twists are for fiction only.", blocking: true });
    if (st.perspective === "multiple") out.push({ code: "NONFICTION_MULTI_POV", message: "Multiple viewpoints are for fiction only.", blocking: true });
  }
  if (st.selectedIndex !== null && !st.alternatives[st.selectedIndex]) out.push({ code: "BAD_SELECTION", message: "The selected story no longer exists.", blocking: true });
  // Persona-led first person = exactly one primary first-person narrator.
  const narrators = st.cast.filter((c) => c.role === "primary_narrator");
  if (st.narration.personaLed) {
    if (st.narration.pov !== "first_person") out.push({ code: "PERSONA_LED_NEEDS_FIRST_PERSON", message: "Persona-led storytelling is told in first person. Pick first person or turn persona-led off.", blocking: true });
    if (narrators.length !== 1) out.push({ code: "ONE_PRIMARY_NARRATOR", message: "Persona-led books have exactly one primary narrator.", blocking: true });
    if (st.perspective === "multiple") out.push({ code: "PERSONA_LED_SINGLE_NARRATOR", message: "Persona-led mode keeps one first-person narrator. Choose single perspective, or turn persona-led off for multiple viewpoints.", blocking: true });
  } else if (narrators.length > 1) out.push({ code: "ONE_PRIMARY_NARRATOR", message: "Only one character can be the primary narrator.", blocking: true });
  if (st.narration.narratorKey && !byKey.has(st.narration.narratorKey)) out.push({ code: "NARRATOR_NOT_IN_CAST", message: "The narrator must be in the cast.", blocking: true });
  if (st.narration.vantage === "retrospective" && st.narration.pov !== "first_person") out.push({ code: "RETRO_FIRST_PERSON", message: "Retrospective narration applies to first person only.", blocking: false });
  // Pen names are publishing identities only.
  const pens = (ctx.penNames ?? []).map((p) => p.pen_name.trim().toLowerCase());
  for (const c of st.cast) if (pens.includes(c.name.trim().toLowerCase())) out.push({ code: "PEN_NAME_AS_CHARACTER", message: `"${c.name}" is one of your pen names. Pen names cannot be characters or narrators.`, blocking: true });
  // Viewpoints.
  if (st.perspective === "single" && st.viewpoints.length > 1) out.push({ code: "SINGLE_ONE_VIEWPOINT", message: "Single perspective uses one viewpoint character.", blocking: true });
  const seen = new Map<number, string>();
  for (const v of st.viewpoints) {
    if (!byKey.has(v.castKey)) out.push({ code: "VIEWPOINT_NOT_IN_CAST", message: "Every viewpoint character must be in the cast.", blocking: true });
    for (const ch of v.chapters) {
      if (ctx.chapterCount && ch >= ctx.chapterCount) out.push({ code: "VIEWPOINT_CHAPTER_RANGE", message: `Chapter ${ch + 1} is past the end of the book.`, blocking: false });
      if (seen.has(ch) && seen.get(ch) !== v.castKey) out.push({ code: "HEAD_HOPPING", message: `Chapter ${ch + 1} has two viewpoint characters. Give each chapter one viewpoint.`, blocking: true });
      seen.set(ch, v.castKey);
    }
  }
  for (const t of st.twists) if (t.status === "approved" && ctx.chapterCount && t.revealChapter !== null && t.revealChapter >= ctx.chapterCount) out.push({ code: "TWIST_CHAPTER_RANGE", message: "A twist is scheduled past the last chapter.", blocking: true });
  const dupIds = st.cast.map((c) => c.identityId).filter(Boolean);
  if (new Set(dupIds).size !== dupIds.length) out.push({ code: "DUPLICATE_IDENTITY", message: "The same persona is in the cast twice.", blocking: true });
  return dedupe(out);
}
const dedupe = (xs: SetupIssue[]) => xs.filter((x, i) => xs.findIndex((y) => y.code === x.code && y.message === x.message) === i);

/** Once prose exists, only fields that cannot change accepted history stay editable. */
export function lockedChanges(prev: BookSetup, next: BookSetup, hasProse: boolean): string[] {
  if (!hasProse) return [];
  const out: string[] = [];
  if (prev.narration.vantage !== next.narration.vantage) out.push("narrative vantage");
  if (prev.narration.pov !== next.narration.pov) out.push("point of view");
  if (prev.narration.narratorKey !== next.narration.narratorKey) out.push("narrator");
  if (prev.universeId !== next.universeId) out.push("shared universe");
  if (prev.selectedIndex !== next.selectedIndex || JSON.stringify(prev.alternatives[prev.selectedIndex ?? -1] ?? null) !== JSON.stringify(next.alternatives[next.selectedIndex ?? -1] ?? null)) out.push("selected story");
  for (const c of prev.cast) {
    const n = next.cast.find((x) => x.key === c.key);
    if (!n) out.push(`cast member ${c.name} (removed)`);
    else if (n.identityId !== c.identityId) out.push(`identity of ${c.name}`);
  }
  return out;
}

/**
 * Planner-only guidance from approved setup. Twist text stays planner-side (the master planner turns
 * it into reveals with setup directives); prose writers only ever see `proseWriterPlanView`.
 */
export function setupPlannerGuidance(st: BookSetup): { guidance: string; alternative: StoryAlternative | null } {
  const lines: string[] = [];
  const alt = st.storyMode === "explore" && st.selectedIndex !== null ? st.alternatives[st.selectedIndex] ?? null : null;
  if (st.fixedRequirements.length) lines.push(`Fixed author requirements (must hold):\n- ${st.fixedRequirements.join("\n- ")}`);
  const approved = st.twistsEnabled ? st.twists.filter((t) => t.status === "approved") : [];
  if (approved.length) {
    lines.push("Author-approved twists (planner-only; schedule each as a reveal with credible setup clues; never state them before their reveal chapter):");
    approved.forEach((t, i) => lines.push(`${i + 1}. ${t.text}${t.revealChapter !== null ? ` — reveal in chapter ${t.revealChapter + 1}` : ""}${t.clues.length ? `; clues: ${t.clues.join("; ")}` : ""}`));
  } else if (!st.twistsEnabled && alt) lines.push("Plot twist development is OFF: keep the chosen story's turns but do not add new twists.");
  if (st.cast.length) {
    lines.push("Cast and book roles (roles are for this book only; do not alter established persona biographies):");
    st.cast.forEach((c) => lines.push(`- ${c.name}: ${c.role.replace(/_/g, " ")}${c.lightweight ? " (book-only character)" : " (persistent identity)"}${c.note ? ` — ${c.note}` : ""}`));
  }
  const name = (k: string | null) => st.cast.find((c) => c.key === k)?.name;
  lines.push(`Point of view: ${st.narration.pov.replace(/_/g, " ")}${st.narration.personaLed ? " (persona-led: one primary first-person narrator)" : ""}.`);
  if (name(st.narration.narratorKey)) lines.push(`Narrator: ${name(st.narration.narratorKey)}, ${st.narration.vantage} narration${st.narration.vantage === "retrospective" && st.narration.tellingDate ? ` told from ${st.narration.tellingDate}` : ""}.`);
  if (st.perspective === "multiple" && st.viewpoints.length) {
    lines.push("Multiple viewpoints (one viewpoint per scene, no head-hopping; each viewpoint knows only what that character has learned):");
    st.viewpoints.forEach((v) => lines.push(`- ${name(v.castKey) ?? v.castKey}: ${v.purpose || "viewpoint"}${v.chapters.length ? ` — chapters ${v.chapters.map((c) => c + 1).join(", ")}` : ""}`));
  }
  if (st.universeId) lines.push("This book belongs to a shared universe: respect established dates, ages, deaths and relationships of existing characters.");
  lines.push("This setup is a planning direction, not established canon.");
  return { guidance: lines.join("\n").slice(0, 7000), alternative: alt };
}

/** Applies the persisted setup to the book columns that Phase 3 reads (narrator, vantage, universe, pen name). */
export function setupBookColumns(st: BookSetup): { pov: string; narrative_vantage: string; narrator_identity_id: string | null; universe_id: string | null; author_identity_id: string | null; narrator_telling_date: unknown } {
  const narrator = st.cast.find((c) => c.key === st.narration.narratorKey);
  return {
    pov: st.narration.pov, narrative_vantage: st.narration.vantage, narrator_identity_id: narrator?.identityId ?? null,
    universe_id: st.universeId, author_identity_id: st.penNameId,
    narrator_telling_date: st.narration.vantage === "retrospective" && st.narration.tellingDate ? { rawText: st.narration.tellingDate } : null,
  };
}

// ── Twists service ───────────────────────────────────────────────────────────
export function buildTwistPrompt(b: BookBrief, alt: StoryAlternative | null, count: number): Prompt {
  return {
    system: "You are a story architect proposing plot twists. Twists must be surprising yet credible, planted with fair clues, consistent with the story and fixed requirements, and never arbitrary or repetitive. Output strict JSON only.",
    user: `Book: ${b.title} (${b.bookType}, ${b.genre ?? "general"}). Chapters: ${b.chapterCount}.\nPremise: ${b.premise}\n${b.guidance ? `Author guidance:\n${b.guidance}\n` : ""}` +
      (alt ? `Selected story:\n${alt.title}\n${alt.summary}\nEnding: ${alt.ending}\n` : "") +
      `Propose ${count} distinct twists, mixing: a revelation, a reversal, a hidden motive, a shifting loyalty, a misunderstood earlier event. ` +
      `JSON: {"twists":[{"text":"","revealChapter":0,"clues":["concrete planted clue"]}]} (revealChapter is 0-based and < ${b.chapterCount}).`,
  };
}
export function parseTwists(raw: string, chapterCount: number): ParseResult<SetupTwist[]> {
  // deno-lint-ignore no-explicit-any
  let o: any; try { o = extractJson(raw); } catch { return { ok: false, issues: ["Not JSON"] }; }
  const list = Array.isArray(o?.twists) ? o.twists : [];
  const issues: string[] = [];
  const twists: SetupTwist[] = list.slice(0, 12).map((t: any, i: number) => {
    const ch = Number(t?.revealChapter);
    if (!s(t?.text, 2000)) issues.push(`Twist ${i + 1} is empty`);
    return { id: `t${i + 1}`, text: s(t?.text, 2000), status: "proposed" as const, revealChapter: Number.isInteger(ch) && ch >= 0 && ch < chapterCount ? ch : null, clues: (Array.isArray(t?.clues) ? t.clues : []).map((x: unknown) => s(x, 400)).filter(Boolean).slice(0, 8) };
  });
  if (!twists.length) issues.push("No twists");
  const texts = twists.map((t) => t.text.toLowerCase());
  if (new Set(texts).size !== texts.length) issues.push("Duplicate twists");
  return issues.length ? { ok: false, issues } : { ok: true, value: twists };
}

// ── Zero-cost deterministic mock engine (same contracts/parsers as live) ─────
function seedOf(t: string) { let h = 2166136261; for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619) >>> 0; return h; }
const CONFLICTS = ["a stolen inheritance", "a disappearance nobody reported", "a forbidden alliance", "a rigged election", "a plague of lies in a small town", "a rescue that goes wrong", "a confession that cannot be true", "a debt owed to the wrong people", "a rival who returns from the dead", "a secret map to a drowned city"];
const STRUCTURES = ["linear countdown", "dual timeline", "braided ensemble", "mystery box", "road journey", "siege", "heist", "coming-of-age arc", "revenge arc", "redemption arc"];
const ENDINGS = ["bittersweet victory", "tragic sacrifice", "quiet reconciliation", "ambiguous escape", "triumphant reversal", "costly truth", "open door to a sequel", "justice delayed", "love chosen over duty", "the villain was right"];

/** Deterministic mock model output for alternatives (valid JSON for `parseAlternatives`). */
export function mockAlternativesOutput(b: BookBrief, count: number, fixed: string[] = []): string {
  const seed = seedOf(`${b.title}|${b.premise}|${count}`);
  const fixedLine = fixed.length ? ` Fixed: ${fixed.join("; ")}.` : "";
  const alts = Array.from({ length: count }, (_, i) => {
    const k = (seed + i * 7) % 10;
    const conflict = CONFLICTS[(k + i) % 10], structure = STRUCTURES[(k + 3 * i) % 10], ending = ENDINGS[(k + 5 * i) % 10];
    const para = `Built as a ${structure}, this version of "${b.title}" turns on ${conflict}.${fixedLine} It opens as the protagonist is pulled into the conflict, escalates through rising stakes and shifting loyalties, and reaches a turn that reframes what came before. `;
    const summary = (para + `The central tension comes from ${conflict}; the cost of failure is personal and public. ` + "Each act deepens the stakes while planting clues for the final turn. ").repeat(6).trim();
    return { title: `${b.title}: ${structure.replace(/\b\w/g, (c) => c.toUpperCase())}`, logline: `A ${structure} about ${conflict}, ending in ${ending}.`, summary, twist: `What seemed to be ${conflict} was engineered by someone close to the protagonist.`, ending: `A ${ending}.` };
  });
  return JSON.stringify({ alternatives: alts });
}
export function mockConceptsOutput(b: BookBrief, count: number): string {
  const approaches = ["step-by-step method", "case-study driven", "myth-busting", "workbook", "narrative journey", "research synthesis", "framework-first", "Q&A", "habit-based", "contrarian"];
  return JSON.stringify({ concepts: Array.from({ length: count }, (_, i) => ({
    title: `${b.title} — ${approaches[i % 10]}`, coreThesis: `A ${approaches[i % 10]} take on ${b.premise.slice(0, 120)}`, approach: approaches[i % 10],
    pillars: ["Foundation", "Practice", "Mastery"], readerOutcome: "The reader can apply the ideas immediately.", summary: `A ${approaches[i % 10]} book. `.repeat(20),
  })) });
}
export function mockTwistsOutput(b: BookBrief, count: number): string {
  const kinds = ["The trusted mentor has been steering events from the start", "The victim staged their own disappearance", "The rival was protecting the protagonist all along", "The opening event was misread: it was a rescue, not an attack", "The ally's loyalty shifts when the true prize is revealed", "The protagonist caused the original wound without knowing it"];
  const n = Math.max(1, b.chapterCount);
  return JSON.stringify({ twists: Array.from({ length: count }, (_, i) => ({ text: kinds[i % kinds.length], revealChapter: Math.min(n - 1, Math.round(((i + 2) / (count + 2)) * (n - 1))), clues: [`A small inconsistency in chapter ${Math.max(1, i + 1)}`, "An object that is out of place"] })) });
}

// ── Story-driven cast recommendations (never create or merge) ───────────────
export interface CastRecommendation { name: string; status: "existing_match" | "ambiguous" | "new_profile" | "lightweight"; matches: IdentityMatch[]; reason: string }

/** Finds capitalised two-word names in the chosen story and classifies them against existing identities. */
export function recommendCast(text: string, identities: KnownIdentity[], universeId: string | null, existingCast: SetupCastMember[] = []): CastRecommendation[] {
  const names = [...new Set((text.match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g) ?? []).filter((n) => !/^(The|A|An|In|On|At|Chapter|Built|What|Each|It)\b/.test(n)))].slice(0, 20);
  const inCast = new Set(existingCast.map((c) => c.name.toLowerCase()));
  const out: CastRecommendation[] = [];
  for (const name of names) {
    if (inCast.has(name.toLowerCase())) continue;
    const r = resolveIdentity(identities, { displayName: name, universeId });
    if (r.status === "EXACT_MATCH") out.push({ name, status: "existing_match", matches: r.matches, reason: "Matches an existing persona — reuse it (author confirms)." });
    else if (r.status === "AMBIGUOUS") out.push({ name, status: "ambiguous", matches: r.matches, reason: "Similar to existing characters — you decide if it's the same person." });
    else out.push({ name, status: (text.split(name).length - 1) >= 2 ? "new_profile" : "lightweight", matches: [], reason: (text.split(name).length - 1) >= 2 ? "Appears often — a reusable profile may help." : "Minor — a book-only character is enough." });
  }
  // Missing story functions.
  const roles = new Set(existingCast.map((c) => c.role));
  if (!roles.has("protagonist")) out.push({ name: "(protagonist)", status: "lightweight", matches: [], reason: "No protagonist assigned yet." });
  if (!roles.has("antagonist") && !roles.has("rival")) out.push({ name: "(opposing force)", status: "lightweight", matches: [], reason: "No antagonist or rival assigned yet." });
  return out;
}

// ── Unmatched identity review decisions ──────────────────────────────────────
export type ReviewDecision = "confirm_existing" | "different_character" | "create_lightweight" | "defer" | "dismiss";
export const REVIEW_DECISIONS: readonly ReviewDecision[] = ["confirm_existing", "different_character", "create_lightweight", "defer", "dismiss"];

/** Validates a decision against the review's own candidates (ambiguous rows can only confirm a listed candidate). */
export function checkReviewDecision(review: { reason: string; candidate_identity_ids: string[]; status: string }, decision: ReviewDecision, identityId?: string | null): string | null {
  if (review.status !== "PENDING") return "Already decided";
  if (!REVIEW_DECISIONS.includes(decision)) return "Unknown decision";
  if (decision === "confirm_existing") {
    if (!identityId) return "Pick the matching character";
    if (review.reason === "ambiguous" && !review.candidate_identity_ids.includes(identityId)) return "That character is not one of the possible matches";
  }
  return null;
}

export const ALTERNATIVE_COUNTS = STORY_ALTERNATIVE_COUNTS;
