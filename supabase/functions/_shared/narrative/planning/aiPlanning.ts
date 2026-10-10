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
  "Never use the words magic or magical. Word counts are planning estimates, not quotas: never pad or trim to hit them.";
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
}
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
  if (!adapterForBookType(bookType).isFiction) throw new Error("Story alternatives are only available for fiction");
  if (!(STORY_ALTERNATIVE_COUNTS as readonly number[]).includes(count)) throw new Error("Count must be 3, 5, 7 or 10");
}

export function buildAlternativesPrompt(b: BookBrief, count: AlternativeCount): Prompt {
  assertAlternativesEligible(b.bookType, count);
  const a = adapterForBookType(b.bookType);
  return {
    system: system(a, "You design complete, genuinely different versions of a story for an author to choose from."),
    user: `${briefText(b)}\n\nWrite exactly ${count} complete story alternatives. Each is about 500 words and tells the whole story from opening to final resolution, ` +
      "including its central twist or reveals and the ending. They must differ from beginning to end — different engines of conflict, different turns, different endings — " +
      "not variations on one plot and not drawn from a fixed list of twist types.\n" +
      'JSON: {"alternatives":[{"title":"","logline":"","summary":"(~500 words)","twist":"(the key reveal in one or two sentences)","ending":"(one or two sentences)"}]}',
  };
}

function overlap(a: string, b: string): number {
  const A = new Set(a.toLowerCase().match(/[a-z]{4,}/g) ?? []), B = new Set(b.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

export function parseAlternatives(raw: string, count: AlternativeCount): ParseResult<StoryAlternative[]> {
  return parseWith(raw, (o, issues) => {
    const list = Array.isArray(o?.alternatives) ? o.alternatives : [];
    if (list.length !== count) issues.push(`Expected ${count} alternatives, got ${list.length}`);
    const out: StoryAlternative[] = list.map((x: any, i: number) => ({
      id: `alt${i + 1}`, title: str(x?.title), logline: str(x?.logline), summary: str(x?.summary), twist: str(x?.twist), ending: str(x?.ending),
    }));
    out.forEach((x, i) => {
      if (!x.title || !x.logline || !x.twist || !x.ending) issues.push(`Alternative ${i + 1} is missing fields`);
      const w = words(x.summary);
      if (w < 300 || w > 800) issues.push(`Alternative ${i + 1} summary is ${w} words; aim for about 500`);
    });
    const titles = new Set(out.map((x) => x.title.toLowerCase()));
    if (titles.size !== out.length) issues.push("Alternative titles must be distinct");
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      if (overlap(out[i].summary, out[j].summary) > 0.7) issues.push(`Alternatives ${i + 1} and ${j + 1} are too similar`);
    }
    return out;
  });
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
      `JSON: {"premise":"","synopsis":"(whole book, 300-600 words)","ending":"","genre_data":{${fields.map((f) => `"${f}":""`).join(",")}}` +
      (a.isFiction ? ',"reveals":[{"summary":"","revealChapter":0,"setupChapters":[0]}]' : "") +
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
    })) : [];
    if (a.isFiction) genreData.reveals = reveals;
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
    raw = await call({ system: prompt.system, user: `${prompt.user}\n\nYour previous reply was rejected:\n- ${r.issues.slice(0, 20).join("\n- ")}\n\nPrevious reply:\n${raw.slice(0, 12000)}\n\nReturn the corrected full JSON object only.` });
    r = parse(raw);
    attempts++;
  }
  return r.ok ? { ok: true, value: r.value, attempts, issues: [] } : { ok: false, attempts, issues: r.issues };
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
    if (!r.ok) { res.failed = { chapter: ch, issues: r.issues }; break; }
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
