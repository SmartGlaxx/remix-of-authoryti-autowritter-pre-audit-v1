// Phase D AI planning services — pure prompt builders, parsers, repair loop and
// checkpointed batch runner. No network, no database: edge functions inject the model
// call and persistence. Planning models see the WHOLE book (ending, every reveal);
// only prose-writing roles get the spoiler-gated view (proseWriterPlanView).
import { adapterForBookType, getAdapter, type GenreAdapter } from "./adapters.ts";
import {
  allocate, buildPlanSkeleton, revealsVisibleAt, validatePlan,
  type ChapterPlan, type MasterPlanSkeleton, type PlannedReveal, type SectionPlan, type SeriesRef,
} from "./engine.ts";

export const STORY_ALTERNATIVE_COUNTS = [3, 5, 7, 10] as const;
export type AlternativeCount = typeof STORY_ALTERNATIVE_COUNTS[number];
export const EVIDENCE_TIERS = ["documented", "recollection", "uncertain", "illustrative"] as const;
export type EvidenceTier = typeof EVIDENCE_TIERS[number];

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: string[] };
export interface Prompt { system: string; user: string }

// ── shared directives ────────────────────────────────────────────────────────
const PLANNER_KNOWLEDGE =
  "You are the book's architect. You know the complete book: its ending, every reveal and twist, every arc and dependency. " +
  "Use that knowledge to plant setups, pace escalation and make the ending feel earned. These plans are read by planners only; " +
  "prose writers receive a separate, spoiler-gated view, so never hide or soften future developments here.";
const ANTI_FORMULA =
  "Avoid formula. Do not give every chapter or section the same shape, length or beat sequence. Vary structure to fit what each part must do. " +
  "Be concrete: name specific choices, objects, evidence, places, methods and consequences. No vague filler such as 'tension rises', 'emotions run high', 'a deep dive'. " +
  "Word counts are planning estimates, not quotas: never pad or trim to hit them.";
const FACTUAL =
  "This is a true story. Never invent biographical facts, events, quotations or participants. Tag every planned claim with an evidence tier: " +
  "documented (from the provided sources, name the source), recollection (the subject's or author's memory), uncertain (disputed or unknown — say so), " +
  "illustrative (sensory staging of a documented moment that adds no new facts). Never claim anything was independently verified.";
const JSON_ONLY = "Reply with one JSON object only, no markdown, no commentary.";

function system(a: GenreAdapter, role: string): string {
  return [role, PLANNER_KNOWLEDGE, ANTI_FORMULA, a.factual ? FACTUAL : "", a.isFiction ? "" : "This is not fiction: no twists, reveals or invented plot.", JSON_ONLY]
    .filter(Boolean).join("\n\n");
}

export interface BookBrief {
  title: string; bookType: string; genre?: string | null; audience?: string | null;
  premise: string; guidance?: string | null; targetWords: number; chapterCount: number; series?: SeriesRef | null;
  /** Planned multi-book series (author choice). Each book gets its own 450–500 word summary. */
  seriesPlan?: { books: number } | null;
  /** Inception plot-twist mode (fiction alternatives): true = twist-architected, false = clean arcs, undefined = unspecified. */
  twistMode?: boolean;
}

// ── Elastic summary length by book type (a guideline for the model, a loose bound for checks) ──
export interface SummaryBand { min: number; max: number }
const EPIC_GENRE = /fantasy|thriller|mystery|crime|sci-?fi|science fiction|epic|suspense/i;
export function summaryBand(bookType: string, genre?: string | null): SummaryBand {
  if (bookType === "comic") return { min: 150, max: 350 };
  if (["children", "short-story", "poetry"].includes(bookType)) return { min: 200, max: 400 };
  if (bookType === "novel") return { min: 300, max: 350 };
  if (["fiction-serial", "drama", "biography", "memoir"].includes(bookType)) return EPIC_GENRE.test(genre ?? "") && bookType !== "biography" && bookType !== "memoir" ? { min: 450, max: 500 } : { min: 450, max: 500 };
  return { min: 350, max: 500 };
}
/** Series books: each book summary is 450–500 words regardless of type. */
export const SERIES_BOOK_BAND: SummaryBand = { min: 450, max: 500 };
const bandText = (bd: SummaryBand) => `${bd.min}–${bd.max} words (use what the story genuinely needs within that range — not a fixed count)`;
const seriesText = (b: BookBrief) => b.seriesPlan && b.seriesPlan.books > 1 ? `\nThis is a planned series of ${b.seriesPlan.books} books. Each option's summary covers the arc of the whole series and makes clear how each book ends and hooks into the next.` : "";
const briefText = (b: BookBrief) => [
  `Title: ${b.title}`, `Book type: ${b.bookType}`, b.genre ? `Genre: ${b.genre}` : "", b.audience ? `Audience: ${b.audience}` : "",
  `Target length: about ${b.targetWords} words across about ${b.chapterCount} chapters (estimates).`,
  `Premise: ${b.premise}`, b.guidance ? `Author guidance: ${b.guidance}` : "",
].filter(Boolean).join("\n");

// ── JSON helpers ─────────────────────────────────────────────────────────────
export function extractJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("No JSON object found");
  return JSON.parse(t.slice(s, e + 1));
}
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const words = (s: string) => (s.match(/\S+/g) ?? []).length;
function parseWith<T>(raw: string, fn: (o: any, issues: string[]) => T | null): ParseResult<T> {
  let o: any;
  try { o = extractJson(raw); } catch (e) { return { ok: false, issues: [`Invalid JSON: ${(e as Error).message}`] }; }
  const issues: string[] = [];
  const v = fn(o, issues);
  return v !== null && !issues.length ? { ok: true, value: v } : { ok: false, issues: issues.length ? issues : ["Unusable output"] };
}

// ── Service 1: complete story alternatives (fiction only) ───────────────────
export interface StoryAlternative { id: string; title: string; logline: string; summary: string; twist: string; ending: string }

export function assertAlternativesEligible(bookType: string, count: number): void {
  adapterForBookType(bookType); // any app book type may brainstorm alternatives
  if (!(STORY_ALTERNATIVE_COUNTS as readonly number[]).includes(count)) throw new Error("Count must be 3, 5, 7 or 10");
}

export function buildAlternativesPrompt(b: BookBrief, count: AlternativeCount): Prompt {
  assertAlternativesEligible(b.bookType, count);
  const a = adapterForBookType(b.bookType);
  if (!a.isFiction) return {
    system: system(a, "You brainstorm complete, genuinely different approaches to a book for an author to choose from."),
    user: `${briefText(b)}${seriesText(b)}\n\nWrite exactly ${count} complete book alternatives. Each summary is ${bandText(summaryBand(b.bookType, b.genre))} and describes the whole book from opening to final chapter: ` +
      "its angle, structure, key ideas and what the reader walks away with. They must differ throughout — different angles, structures and outcomes — not variations on one outline. " +
      "Invent no facts, quotes or statistics.\n" +
      'JSON: {"alternatives":[{"title":"","logline":"(one-sentence pitch)","summary":"(whole book)","twist":"(the key insight or fresh angle in one or two sentences)","ending":"(what the reader gains, one or two sentences)"}]}',
  };
  return {
    system: system(a, "You design complete, genuinely different versions of a story for an author to choose from."),
    user: `${briefText(b)}${seriesText(b)}\n\nWrite exactly ${count} complete story alternatives. Each summary is ${bandText(summaryBand(b.bookType, b.genre))} and tells the whole story from opening to final resolution, ` +
      "including its central twist or reveals and the ending. They must differ from beginning to end — different engines of conflict, different turns, different endings — " +
      "not variations on one plot and not drawn from a fixed list of twist types.\n" + twistModeText(b) +
      'JSON: {"alternatives":[{"title":"","logline":"","summary":"(whole story)","twist":"(the key reveal in one or two sentences)","ending":"(one or two sentences)"}]}',
  };
}

/** Plot-twist mode is chosen at inception: ON architects every option around one major twist from the first page. */
export const TWIST_MODE_ON =
  "PLOT TWIST MODE IS ON. Build every alternative around one major, story-reframing twist designed from the start — not added at the end. " +
  "The premise, characters and early events must plant fair clues that point the reader the wrong way; the reveal must recolour everything before it, and the ending must pay it off. " +
  "Each alternative's twist must be a different kind of reversal.\n";
export const TWIST_MODE_OFF =
  "Plot twist mode is off: build clean, honest arcs driven by conflict and character. Do not engineer a misdirection or a shock reversal; the 'twist' field names the story's key turning point.\n";
function twistModeText(b: BookBrief): string {
  if (b.twistMode === true) return TWIST_MODE_ON;
  if (b.twistMode === false) return TWIST_MODE_OFF;
  return "";
}

// ── Service 0: "Adjust with AI" — rewrite the author's seed idea in a chosen direction (no alternatives) ──
export const PREMISE_ADJUSTMENTS = {
  twists: "more plot twists and reversals: betrayals, false assumptions, hidden identities",
  drama: "more drama and higher personal stakes",
  romance: "more romance and emotional chemistry",
  darker: "a darker, grittier, more morally ambiguous tone",
  pacing: "faster pacing, tighter deadlines and more thrills",
  mystery: "more mystery, secrets and hidden clues",
  depth: "more thematic and philosophical depth",
  humor: "more humour and wit",
  clarity: "a clearer, sharper hook and central question",
  practical: "more practical, actionable value for the reader",
} as const;
export type PremiseAdjustment = keyof typeof PREMISE_ADJUSTMENTS;

export function buildAdjustPremisePrompt(b: BookBrief, adjustments: PremiseAdjustment[], custom?: string | null): Prompt {
  const a = adapterForBookType(b.bookType);
  const wants = [...adjustments.filter((k) => k in PREMISE_ADJUSTMENTS).map((k) => PREMISE_ADJUSTMENTS[k]), custom?.trim() || ""].filter(Boolean);
  if (!wants.length) throw new Error("Choose at least one adjustment");
  if (!b.premise.trim()) throw new Error("Write an idea first");
  return {
    system: system(a, "You revise an author's book idea in the direction they ask, keeping everything they wrote that still fits."),
    user: `${briefText(b)}\n\nRevise the premise above to add: ${wants.join("; ")}.\n` +
      "Keep the author's names, setting and core idea unless they conflict with the request. Write 80–250 words, a seed idea (not a full outline). " +
      (a.isFiction ? "" : "Invent no facts, quotes or statistics. ") +
      'JSON: {"premise":"(the revised idea)","changes":"(one sentence on what changed)"}',
  };
}

export function parseAdjustedPremise(raw: string): ParseResult<{ premise: string; changes: string }> {
  return parseWith(raw, (o, issues) => {
    const premise = str(o?.premise), changes = str(o?.changes);
    if (words(premise) < 20) issues.push("Revised premise is too short");
    if (words(premise) > 400) issues.push("Revised premise is too long");
    return { premise, changes };
  });
}

function overlap(a: string, b: string): number {
  const A = new Set(a.toLowerCase().match(/[a-z]{4,}/g) ?? []), B = new Set(b.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

export function parseAlternatives(raw: string, count: AlternativeCount, band: SummaryBand = { min: 500, max: 600 }): ParseResult<StoryAlternative[]> {
  // Loose bounds: the band guides the model; only clearly too short / too long output is repaired.
  const lo = Math.round(band.min * 0.6), hi = Math.round(band.max * 1.35);
  return parseWith(raw, (o, issues) => {
    const list = Array.isArray(o?.alternatives) ? o.alternatives : [];
    if (list.length !== count) issues.push(`Expected ${count} alternatives, got ${list.length}`);
    const out: StoryAlternative[] = list.map((x: any, i: number) => ({
      id: `alt${i + 1}`, title: str(x?.title), logline: str(x?.logline), summary: str(x?.summary), twist: str(x?.twist), ending: str(x?.ending),
    }));
    out.forEach((x, i) => {
      if (!x.title || !x.logline || !x.twist || !x.ending) issues.push(`Alternative ${i + 1} is missing fields`);
      const w = words(x.summary);
      if (w < lo || w > hi) issues.push(`Alternative ${i + 1} summary is ${w} words; aim for ${band.min}–${band.max}`);
    });
    const titles = new Set(out.map((x) => x.title.toLowerCase()));
    if (titles.size !== out.length) issues.push("Alternative titles must be distinct");
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      if (overlap(out[i].summary, out[j].summary) > 0.7) issues.push(`Alternatives ${i + 1} and ${j + 1} are too similar`);
    }
    return out;
  });
}

// ── Service 1b: nonfiction concepts (separate from fiction alternatives — no twists) ─────
export interface NonfictionConcept {
  id: string; title: string; coreThesis: string; approach: string; pillars: string[]; readerOutcome: string; summary: string;
}

export function assertConceptsEligible(bookType: string, count: number): void {
  adapterForBookType(bookType);
  if (!(STORY_ALTERNATIVE_COUNTS as readonly number[]).includes(count)) throw new Error("Count must be 3, 5, 7 or 10");
}

export function buildConceptsPrompt(b: BookBrief, count: AlternativeCount): Prompt {
  assertConceptsEligible(b.bookType, count);
  const a = adapterForBookType(b.bookType);
  return {
    system: system(a, "You design genuinely different approaches to a nonfiction book for an author to choose from."),
    user: `${briefText(b)}\n\nWrite exactly ${count} distinct book concepts. Each is about 300 words and differs in its central argument or promise, ` +
      "its method of delivering it (framework, case studies, chronology, problem-solution, field guide, etc.) and what the reader can do or understand at the end. " +
      "No protagonists, plot, twists or reveals. Never invent sources, statistics or quotations.\n" +
      'JSON: {"concepts":[{"title":"","coreThesis":"(one or two sentences)","approach":"(how the book is organised and argued)","pillars":["(3-6 key supports: evidence, cases, steps)"],"readerOutcome":"(what the reader gains)","summary":"(~300 words)"}]}',
  };
}

export function parseConcepts(raw: string, count: AlternativeCount): ParseResult<NonfictionConcept[]> {
  return parseWith(raw, (o, issues) => {
    const list = Array.isArray(o?.concepts) ? o.concepts : [];
    if (list.length !== count) issues.push(`Expected ${count} concepts, got ${list.length}`);
    const out: NonfictionConcept[] = list.map((x: any, i: number) => ({
      id: `concept${i + 1}`, title: str(x?.title), coreThesis: str(x?.coreThesis), approach: str(x?.approach),
      pillars: Array.isArray(x?.pillars) ? x.pillars.map(str).filter(Boolean).slice(0, 8) : [], readerOutcome: str(x?.readerOutcome), summary: str(x?.summary),
    }));
    out.forEach((x, i) => {
      if (!x.title || !x.coreThesis || !x.approach || !x.readerOutcome) issues.push(`Concept ${i + 1} is missing fields`);
      if (x.pillars.length < 2) issues.push(`Concept ${i + 1} needs at least two pillars`);
      if (/\b(plot twist|protagonist|twist)\b/i.test(`${x.coreThesis} ${x.approach} ${x.summary}`)) issues.push(`Concept ${i + 1} uses fiction structure`);
    });
    if (new Set(out.map((x) => x.title.toLowerCase())).size !== out.length) issues.push("Concept titles must be distinct");
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      if (overlap(`${out[i].coreThesis} ${out[i].approach}`, `${out[j].coreThesis} ${out[j].approach}`) > 0.7) issues.push(`Concepts ${i + 1} and ${j + 1} are too similar`);
    }
    return out;
  });
}

/** A chosen nonfiction concept steers the master plan as author guidance — never as a story alternative. */
export function conceptGuidance(c: NonfictionConcept): string {
  return [`Chosen concept: ${c.title}`, `Core thesis: ${c.coreThesis}`, `Approach: ${c.approach}`, `Pillars: ${c.pillars.join("; ")}`, `Reader outcome: ${c.readerOutcome}`].join("\n");
}

// ── Service 2: master plan ───────────────────────────────────────────────────
export interface MasterPlanDraft {
  premise: string; synopsis: string; ending: string; skeleton: MasterPlanSkeleton; alternative: StoryAlternative | null;
}

export function buildMasterPrompt(b: BookBrief, alternative: StoryAlternative | null): Prompt {
  const a = adapterForBookType(b.bookType);
  const fields = a.masterFields.filter((f) => f !== "reveals");
  return {
    system: system(a, "You write the master plan for a whole book."),
    user: `${briefText(b)}\n` + (alternative ? `\nChosen story direction (author-selected, build on it):\n${alternative.title}\n${alternative.summary}\nTwist: ${alternative.twist}\nEnding: ${alternative.ending}\n` : "") +
      `\nPlan the whole book. Chapter objective kinds must come from: ${a.chapterObjectives.join(", ")}. ` +
      `Each chapter is made of ${a.sectionUnit}s; suggest a section count per chapter that fits its job (typical ${a.sectionsPerChapter.min}–${a.sectionsPerChapter.max}, a guideline only), ` +
      "and a relative weight (1 = average length) where a chapter needs more or less room.\n" +
      (b.seriesPlan && b.seriesPlan.books > 1 ? `This book belongs to a planned series of ${b.seriesPlan.books} books. Also give "seriesBooks": one entry per book in the series, each with its own inciting incident, climax and hook into the next; the synopsis is the whole series arc.\n` : "") +
      `JSON: {"premise":"","synopsis":"(whole book, ${bandText(summaryBand(b.bookType, b.genre))})","ending":"","genre_data":{${fields.map((f) => `"${f}":""`).join(",")}}` +
      (a.isFiction ? ',"reveals":[{"summary":"","secretTerms":["words that would give it away"],"revealChapter":0,"setupChapters":[0],"setupDirectives":[{"chapterIndex":0,"writerInstruction":"concrete on-page behaviour or clue, never the explanation","viewpointKnows":"","readerSees":""}]}]' : "") +
      (b.seriesPlan && b.seriesPlan.books > 1 ? `,"seriesBooks":[{"bookNumber":1,"title":"","summary":"(${bandText(SERIES_BOOK_BAND)})"}]` : "") +
      `,"chapters":[{"objectiveKind":"","objective":"","sectionCount":${a.sectionsPerChapter.default},"weight":1}]}`,
  };
}

export interface ChapterShape { objectiveKind: string; objective: string; sectionCount?: number; weight?: number }

/** Builds a skeleton with adaptive section counts and weighted word estimates (sums stay exact). */
export function shapeSkeleton(input: { bookType: string; targetWords: number; genreData: Record<string, unknown>; reveals: PlannedReveal[]; series?: SeriesRef | null; chapters: ChapterShape[] }): MasterPlanSkeleton {
  const a = adapterForBookType(input.bookType);
  const n = Math.max(1, input.chapters.length);
  const base = buildPlanSkeleton({ bookType: input.bookType, targetWords: Math.max(input.targetWords, n * a.sectionsPerChapter.max * a.minSectionWords), chapterCount: n, genreData: input.genreData, reveals: input.reveals, series: input.series ?? null });
  const weights = input.chapters.map((c, i) => a.weight(n === 1 ? 0.5 : i / (n - 1)) * clamp(c.weight ?? 1, 0.25, 4));
  const cw = allocate(input.targetWords, weights);
  base.targetWords = input.targetWords;
  base.chapters = input.chapters.map((shape, ci) => {
    const maxBySize = Math.max(1, Math.floor(cw[ci] / Math.max(1, Math.floor(a.minSectionWords / 2))));
    const count = clamp(Math.round(shape.sectionCount ?? a.sectionsPerChapter.default), 1, Math.min(30, maxBySize));
    const ch: ChapterPlan = { ...base.chapters[ci], objectiveKind: shape.objectiveKind, objective: shape.objective, targetWords: cw[ci], sections: [] };
    ch.sections = buildSections(a, ci, allocate(cw[ci], Array(count).fill(1)), ch.dependsOn.length > 0 || !["cookbook", "magazine"].includes(a.id));
    return ch;
  });
  return base;
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

function buildSections(a: GenreAdapter, ci: number, sw: number[], sequential: boolean, objectives: string[] = [], deps: string[][] = [], beatKinds: string[][] = []): SectionPlan[] {
  return sw.map((w, s) => {
    const kinds = beatKinds[s]?.length ? beatKinds[s] : [...a.beatKinds];
    return {
      id: `c${ci}s${s}`, chapterIndex: ci, sectionIndex: s, unit: a.sectionUnit, objective: objectives[s] ?? "", targetWords: w,
      dependsOn: deps[s] ?? (s > 0 && sequential ? [`c${ci}s${s - 1}`] : []),
      beats: allocate(w, Array(kinds.length).fill(1)).map((bw, b) => ({ id: `c${ci}s${s}b${b}`, kind: kinds[b], order: b, targetWords: bw })),
    };
  });
}

export function parseMaster(raw: string, b: BookBrief, alternative: StoryAlternative | null): ParseResult<MasterPlanDraft> {
  const a = adapterForBookType(b.bookType);
  return parseWith(raw, (o, issues) => {
    const genreData: Record<string, unknown> = { ...(o?.genre_data ?? {}) };
    const chapters: ChapterShape[] = (Array.isArray(o?.chapters) ? o.chapters : []).map((c: any) => ({
      objectiveKind: str(c?.objectiveKind), objective: str(c?.objective), sectionCount: Number(c?.sectionCount) || undefined, weight: Number(c?.weight) || undefined,
    }));
    if (!chapters.length) { issues.push("No chapters"); return null; }
    chapters.forEach((c, i) => { if (!c.objective) issues.push(`Chapter ${i + 1} has no objective`); });
    const reveals: PlannedReveal[] = a.isFiction ? (Array.isArray(o?.reveals) ? o.reveals : []).map((r: any, i: number) => ({
      id: `r${i + 1}`, summary: str(r?.summary), revealChapter: Number(r?.revealChapter), setupChapters: (Array.isArray(r?.setupChapters) ? r.setupChapters : []).map(Number),
      secretTerms: (Array.isArray(r?.secretTerms) ? r.secretTerms : []).map(str).filter(Boolean),
      setupDirectives: (Array.isArray(r?.setupDirectives) ? r.setupDirectives : []).map((d: any) => ({ chapterIndex: Number(d?.chapterIndex), writerInstruction: str(d?.writerInstruction), viewpointKnows: str(d?.viewpointKnows) || undefined, readerSees: str(d?.readerSees) || undefined })).filter((d: any) => Number.isInteger(d.chapterIndex) && d.writerInstruction),
    })) : [];
    if (a.isFiction) genreData.reveals = reveals;
    if (b.seriesPlan && b.seriesPlan.books > 1) {
      const sb = (Array.isArray(o?.seriesBooks) ? o.seriesBooks : []).map((x: any, i: number) => ({ bookNumber: Number(x?.bookNumber) || i + 1, title: str(x?.title), summary: str(x?.summary) })).filter((x: any) => x.summary);
      if (sb.length !== b.seriesPlan.books) issues.push(`Expected ${b.seriesPlan.books} series book summaries, got ${sb.length}`);
      sb.forEach((x: any) => { const w = words(x.summary); if (w < SERIES_BOOK_BAND.min * 0.6 || w > SERIES_BOOK_BAND.max * 1.35) issues.push(`Series book ${x.bookNumber} summary is ${w} words; aim for 450–500`); });
      genreData.series_books = sb;
    }
    if (!a.isFiction && Array.isArray(o?.reveals) && o.reveals.length) issues.push("Nonfiction plans cannot contain reveals");
    const premise = str(o?.premise), synopsis = str(o?.synopsis), ending = str(o?.ending);
    if (!premise || !synopsis || !ending) issues.push("premise, synopsis and ending are required");
    let skeleton: MasterPlanSkeleton;
    try { skeleton = shapeSkeleton({ bookType: b.bookType, targetWords: b.targetWords, genreData, reveals, series: b.series, chapters }); }
    catch (e) { issues.push((e as Error).message); return null; }
    for (const i of validatePlan(skeleton)) issues.push(`${i.code} ${i.ref}: ${i.message}`);
    return { premise, synopsis, ending, skeleton, alternative };
  });
}

// ── whole-book context (planners only) ──────────────────────────────────────
export interface MasterContext { premise: string; synopsis: string; ending: string; skeleton: MasterPlanSkeleton }
/** Full book view for planning models: ending, every reveal and every chapter plan known so far. */
export function renderWholeBook(m: MasterContext, expanded: Record<number, ChapterPlan> = {}): string {
  const p = m.skeleton;
  const lines = [`PREMISE: ${m.premise}`, `WHOLE-BOOK SYNOPSIS: ${m.synopsis}`, `INTENDED ENDING: ${m.ending}`];
  const gd = Object.entries(p.genreData).filter(([k]) => k !== "reveals").map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  if (gd.length) lines.push(`BOOK FRAME: ${gd.join(" | ")}`);
  if (p.reveals.length) lines.push("ALL REVEALS (full knowledge):", ...p.reveals.map((r) => `- ${r.id} revealed in ch${r.revealChapter + 1}, set up in ${r.setupChapters.map((c) => `ch${c + 1}`).join(", ") || "—"}: ${r.summary}`));
  lines.push("CHAPTER MAP:");
  for (const c of p.chapters) {
    const x = expanded[c.chapterIndex];
    lines.push(`- ch${c.chapterIndex + 1} [${c.objectiveKind}] ~${c.targetWords}w: ${c.objective}`);
    if (x) for (const s of x.sections) lines.push(`    · ${s.id} ${s.objective}${s.dependsOn.length ? ` (needs ${s.dependsOn.join(", ")})` : ""}`);
  }
  return lines.join("\n");
}

/** Spoiler-gated view for prose-writing roles: future reveal summaries never leave the planner. */
export function proseWriterPlanView(m: MasterContext, ch: number) {
  const v = revealsVisibleAt(m.skeleton, ch);
  return { chapter: m.skeleton.chapters[ch], revealed: v.revealed, foreshadow: v.foreshadow };
}

// ── Service 3: chapter expansion (adaptive section structure) ───────────────
export interface ChapterExpansion { chapter: ChapterPlan; stakes: string; focus: string }

export function buildChapterPrompt(m: MasterContext, ch: number, expanded: Record<number, ChapterPlan>): Prompt {
  const a = getAdapter(m.skeleton.adapter);
  const c = m.skeleton.chapters[ch];
  const earlier = m.skeleton.chapters.slice(0, ch).flatMap((x) => (expanded[x.chapterIndex]?.sections ?? []).map((s) => s.id));
  return {
    system: system(a, "You expand one chapter of an approved whole-book plan."),
    user: `${renderWholeBook(m, expanded)}\n\nExpand chapter ${ch + 1} ([${c.objectiveKind}] ${c.objective}, about ${c.targetWords} words) in relation to the whole book — what it must set up for later chapters, what it pays off from earlier ones.\n` +
      `Choose the number of ${a.sectionUnit}s this chapter genuinely needs (guideline ${a.sectionsPerChapter.min}–${a.sectionsPerChapter.max}). ` +
      `Section ids are c${ch}s0, c${ch}s1, ... dependsOn may list earlier section ids in this chapter or these earlier ones: ${earlier.slice(-40).join(", ") || "none"}.\n` +
      `JSON: {"objective":"","stakes":"","focus":"","sections":[{"objective":"","weight":1,"dependsOn":[]}]}`,
  };
}

export function parseChapter(raw: string, m: MasterContext, ch: number, expanded: Record<number, ChapterPlan>): ParseResult<ChapterExpansion> {
  const a = getAdapter(m.skeleton.adapter);
  const base = m.skeleton.chapters[ch];
  return parseWith(raw, (o, issues) => {
    const secs = Array.isArray(o?.sections) ? o.sections : [];
    if (!secs.length) { issues.push("No sections"); return null; }
    const known = new Set(m.skeleton.chapters.slice(0, ch).flatMap((x) => (expanded[x.chapterIndex]?.sections ?? base.sections).map((s) => s.id)));
    const objectives = secs.map((s: any) => str(s?.objective));
    objectives.forEach((x: string, i: number) => { if (!x) issues.push(`Section ${i + 1} has no objective`); });
    const deps: string[][] = secs.map((s: any, i: number) => (Array.isArray(s?.dependsOn) ? s.dependsOn : []).map(String).filter((d: string) => {
      const own = /^c(\d+)s(\d+)$/.exec(d);
      const ok = known.has(d) || (own && Number(own[1]) === ch && Number(own[2]) < i);
      if (!ok) issues.push(`Section ${i + 1} depends on unknown or later ${d}`);
      return ok;
    }));
    const weights = secs.map((s: any) => clamp(Number(s?.weight) || 1, 0.25, 4));
    const chapter: ChapterPlan = { ...base, objective: str(o?.objective) || base.objective,
      sections: buildSections(a, ch, allocate(base.targetWords, weights), false, objectives, deps) };
    if (!str(o?.stakes)) issues.push("stakes is required");
    return { chapter, stakes: str(o?.stakes), focus: str(o?.focus) };
  });
}

// ── Service 4: section plans ─────────────────────────────────────────────────
export interface EvidenceItem { claim: string; tier: EvidenceTier; source?: string }
export interface SectionDetail { id: string; entry: string; focus: string; outcome: string; evidence?: EvidenceItem[] }

export function buildSectionPrompt(m: MasterContext, chapter: ChapterPlan, expanded: Record<number, ChapterPlan>): Prompt {
  const a = getAdapter(m.skeleton.adapter);
  const ev = a.factual ? `,"evidence":[{"claim":"","tier":"${EVIDENCE_TIERS.join("|")}","source":""}]` : "";
  return {
    system: system(a, `You detail every ${a.sectionUnit} of one chapter of an approved whole-book plan.`),
    user: `${renderWholeBook(m, { ...expanded, [chapter.chapterIndex]: chapter })}\n\nDetail each ${a.sectionUnit} of chapter ${chapter.chapterIndex + 1}: where it starts, what it turns on, how it ends and what it hands to what comes next.\n` +
      `JSON: {"sections":[{"id":"${chapter.sections[0]?.id}","entry":"","focus":"","outcome":""${ev}}]} — one entry per id: ${chapter.sections.map((s) => s.id).join(", ")}`,
  };
}

export function parseSections(raw: string, m: MasterContext, chapter: ChapterPlan): ParseResult<SectionDetail[]> {
  const a = getAdapter(m.skeleton.adapter);
  const sources = str(m.skeleton.genreData.primary_sources);
  return parseWith(raw, (o, issues) => {
    const list = Array.isArray(o?.sections) ? o.sections : [];
    const byId = new Map(list.map((x: any) => [str(x?.id), x]));
    return chapter.sections.map((s) => {
      const x: any = byId.get(s.id);
      if (!x) { issues.push(`Missing ${s.id}`); return { id: s.id, entry: "", focus: "", outcome: "" }; }
      const d: SectionDetail = { id: s.id, entry: str(x.entry), focus: str(x.focus), outcome: str(x.outcome) };
      if (!d.entry || !d.focus || !d.outcome) issues.push(`${s.id} needs entry, focus and outcome`);
      if (a.factual) {
        const ev: EvidenceItem[] = (Array.isArray(x.evidence) ? x.evidence : []).map((e: any) => ({ claim: str(e?.claim), tier: str(e?.tier) as EvidenceTier, source: str(e?.source) || undefined }));
        if (!ev.length) issues.push(`${s.id} must tag its claims with evidence tiers`);
        for (const e of ev) {
          if (!(EVIDENCE_TIERS as readonly string[]).includes(e.tier)) issues.push(`${s.id}: evidence tier "${e.tier}" not allowed`);
          if (e.tier === "documented" && !e.source) issues.push(`${s.id}: documented claim needs a source`);
          if (e.tier === "documented" && !sources) issues.push(`${s.id}: no sources were provided, so nothing can be documented`);
          if (/independently verified|fact-checked|verified by/i.test(e.claim + " " + (e.source ?? ""))) issues.push(`${s.id}: plans must not claim independent verification`);
        }
        d.evidence = ev;
      }
      return d;
    });
  });
}

// ── Service 5: local writing beats (adaptive, palette-based) ────────────────
export function buildBeatsPrompt(m: MasterContext, chapter: ChapterPlan, details: SectionDetail[], expanded: Record<number, ChapterPlan>): Prompt {
  const a = getAdapter(m.skeleton.adapter);
  return {
    system: system(a, "You break each section into local writing beats."),
    user: `${renderWholeBook(m, { ...expanded, [chapter.chapterIndex]: chapter })}\n\nSections of chapter ${chapter.chapterIndex + 1}:\n` +
      details.map((d) => `- ${d.id}: ${d.entry} → ${d.focus} → ${d.outcome}`).join("\n") +
      `\n\nFor each section choose the beats it actually needs — any subset and order of: ${a.beatKinds.join(", ")} (repeats allowed), 2 to 8 beats. Different sections should have different rhythms.\n` +
      `JSON: {"sections":[{"id":"","beats":[{"kind":"","note":"(concrete)","weight":1}]}]}`,
  };
}

export interface BeatNote { id: string; kind: string; note: string }
export function parseBeats(raw: string, m: MasterContext, chapter: ChapterPlan): ParseResult<{ chapter: ChapterPlan; notes: BeatNote[] }> {
  const a = getAdapter(m.skeleton.adapter);
  return parseWith(raw, (o, issues) => {
    const byId = new Map((Array.isArray(o?.sections) ? o.sections : []).map((x: any) => [str(x?.id), x]));
    const notes: BeatNote[] = [];
    const sections = chapter.sections.map((s) => {
      const beats: any[] = Array.isArray((byId.get(s.id) as any)?.beats) ? (byId.get(s.id) as any).beats : [];
      if (beats.length < 1 || beats.length > 12) issues.push(`${s.id} needs 1-12 beats`);
      for (const b of beats) if (!a.beatKinds.includes(str(b?.kind))) issues.push(`${s.id}: beat kind "${str(b?.kind)}" not valid for ${a.id}`);
      if (!beats.length) return s;
      const w = allocate(s.targetWords, beats.map((b) => clamp(Number(b?.weight) || 1, 0.25, 4)));
      return { ...s, beats: beats.map((b, i) => {
        const id = `${s.id}b${i}`; notes.push({ id, kind: str(b?.kind), note: str(b?.note) });
        if (!str(b?.note)) issues.push(`${id} has no note`);
        return { id, kind: str(b?.kind), order: i, targetWords: w[i] };
      }) };
    });
    return { chapter: { ...chapter, sections }, notes };
  });
}

// ── bounded repair loop ─────────────────────────────────────────────────────
export type ModelCall = (p: Prompt) => Promise<string>;
export interface RepairOutcome<T> { ok: boolean; value?: T; attempts: number; issues: string[] }

/** Calls the model, validates, and asks for a targeted fix at most `maxRepairs` times. Provider errors propagate. */
export async function runWithRepair<T>(call: ModelCall, prompt: Prompt, parse: (raw: string) => ParseResult<T>, maxRepairs = 2): Promise<RepairOutcome<T>> {
  let raw = await call(prompt);
  let r = parse(raw);
  let attempts = 1;
  while (!r.ok && attempts <= maxRepairs) {
    raw = await call({ system: prompt.system, user: `${prompt.user}\n\nYour previous reply was rejected:\n- ${(r as { issues: string[] }).issues.slice(0, 20).join("\n- ")}\n\nPrevious reply:\n${raw.slice(0, 12000)}\n\nReturn the corrected full JSON object only.` });
    r = parse(raw);
    attempts++;
  }
  return r.ok ? { ok: true, value: r.value, attempts, issues: [] } : { ok: false, attempts, issues: (r as { issues: string[] }).issues };
}

// ── checkpointed batch (chapter by chapter) ─────────────────────────────────
export interface BatchResult { completed: number[]; reused: number[]; failed: { chapter: number; issues: string[] } | null }
/**
 * Runs chapters in order. Chapters already checkpointed are reused (no AI call). Each successful
 * chapter is persisted by `runOne` before the next starts. Stops at the first failure so later
 * chapters are never planned on a missing foundation; a retry resumes from the failed chapter.
 */
export async function runChapterBatch(chapters: number[], isDone: (ch: number) => boolean, runOne: (ch: number) => Promise<{ ok: boolean; issues: string[] }>): Promise<BatchResult> {
  const res: BatchResult = { completed: [], reused: [], failed: null };
  for (const ch of chapters) {
    if (isDone(ch)) { res.reused.push(ch); continue; }
    let r: { ok: boolean; issues: string[] };
    try { r = await runOne(ch); } catch (e) { r = { ok: false, issues: [(e as Error).message] }; }
    if (!r.ok) { res.failed = { chapter: ch, issues: (r as { issues: string[] }).issues }; break; }
    res.completed.push(ch);
  }
  return res;
}

/** Stable idempotency key for a planning step (same inputs → same key → no duplicate rows). */
export function planIdemKey(parts: (string | number)[]): string {
  let h = 2166136261;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${parts[0]}:${(h >>> 0).toString(16)}`;
}
