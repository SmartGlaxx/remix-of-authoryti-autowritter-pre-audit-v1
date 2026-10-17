// Stage 2 — Detailed chapter narrative blueprints. Pure, no I/O.
// A blueprint expands an expanded chapter (+ its section plans and beats) into a flowing synopsis,
// the chapter's cast / locations / events with stable ids, and ordered microbeats that reference
// them. It is a PLANNED progressive plan row (level BLUEPRINT) until the author approves it (READY).
// Not wired to prose generation (Stage 3). Planner sees the whole book; writer-facing layers
// (reader knowledge, character knowledge) must never carry later reveal secrets.
import type { ChapterPlan, MasterPlanSkeleton } from "./engine.ts";
import type { MasterContext, ParseResult, Prompt, SectionDetail, BeatNote } from "./aiPlanning.ts";
import { extractJson, renderWholeBook } from "./aiPlanning.ts";

export const BLUEPRINT_SCHEMA_VERSION = 1;
/** Planning heuristic: one microbeat per ~120 words of prose (a paragraph or narrative unit). */
export const WORDS_PER_MICROBEAT = 120;

export interface CastRef { id: string; name: string; aliases?: string[] }
export interface BlueprintCharacter { id: string; name: string; role: string; pov?: boolean }
export interface BlueprintLocation { id: string; name: string; significance: string }
export interface BlueprintEvent { id: string; name: string; consequence: string; source: string }
export interface Microbeat {
  id: string; sectionId: string; order: number; text: string;
  characterIds: string[]; locationId: string; eventIds: string[]; purpose: string; transition: string;
}
export interface CharacterKnowledge { characterId: string; knows: string[]; doesNotKnow: string[] }
export interface KnowledgeLayers { author: string[]; reader: string[]; characters: CharacterKnowledge[] }
export interface CastProposal { id: string; name: string; role: string; justification: string }
export interface ChapterBlueprint {
  schemaVersion: number; chapterIndex: number;
  objective: string; keyPoints: string[]; conclusion: string; synopsis: string;
  cast: BlueprintCharacter[]; locations: BlueprintLocation[]; events: BlueprintEvent[];
  microbeats: Microbeat[]; knowledge: KnowledgeLayers; castProposals: CastProposal[];
}

export interface BlueprintInput {
  m: MasterContext; chapter: ChapterPlan; details: SectionDetail[]; notes: BeatNote[];
  cast: CastRef[]; expanded: Record<number, ChapterPlan>; stakes?: string; focus?: string;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
export const expectedMicrobeats = (targetWords: number) => Math.max(3, Math.round(targetWords / WORDS_PER_MICROBEAT));

/** Planner-only secrets that must not appear in reader- or character-facing layers of this chapter. */
export function futureSecrets(s: MasterPlanSkeleton, ch: number): string[] {
  return (s.reveals ?? []).filter((r) => r.revealChapter > ch).flatMap((r) => r.secretTerms ?? []).filter((t) => t && t.trim().length >= 3);
}
const leaks = (text: string, secrets: string[]) => secrets.filter((t) => new RegExp(`(^|[^a-z0-9])${norm(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(norm(text)));

export function buildBlueprintPrompt(i: BlueprintInput): Prompt {
  const { m, chapter } = i;
  const ch = chapter.chapterIndex;
  const est = expectedMicrobeats(chapter.targetWords);
  const sec = i.details.map((d) => {
    const beats = i.notes.filter((n) => n.id.startsWith(`${d.id}b`)).map((n) => `${n.kind}: ${n.note}`).join("; ");
    return `- ${d.id}: opens ${d.entry} | turns on ${d.focus} | ends ${d.outcome}${beats ? ` | beats: ${beats}` : ""}`;
  }).join("\n");
  const cast = i.cast.map((c) => `- ${c.id}: ${c.name}${c.aliases?.length ? ` (also ${c.aliases.join(", ")})` : ""}`).join("\n") || "- (no cast recorded yet)";
  return {
    system: "You are a book planner. You expand ONE approved chapter into a detailed narrative blueprint. You never invent developments outside the approved plan. Output JSON only.",
    user: `${renderWholeBook(m, { ...i.expanded, [ch]: chapter })}\n\n` +
      `CHAPTER ${ch + 1} — objective: ${chapter.objective}${i.stakes ? `\nStakes: ${i.stakes}` : ""}${i.focus ? `\nFocus: ${i.focus}` : ""}\nAbout ${chapter.targetWords} words.\nApproved sections:\n${sec}\n\n` +
      `Book cast (use these ids; never create a person outside this list — if the approved plan truly needs someone new, add them to castProposals with a justification and use the proposal id):\n${cast}\n\n` +
      `Write the blueprint:\n` +
      `1. keyPoints and conclusion must preserve the chapter's approved objective, plot direction and ending.\n` +
      `2. synopsis: a flowing prose account of the whole chapter from opening to conclusion — as long as completeness needs; no word limit. Names may repeat; every pronoun must be unambiguous.\n` +
      `3. cast / locations / events: every participating character, consequential place and significant event, each with a stable id (locations l0.., events e0..). Every event names its source in the approved plan: "master", "chapter" or a section id.\n` +
      `4. microbeats: about ${est} ordered units (roughly one per planned paragraph; more or fewer where the story needs it), covering every section in order. Each: id (m0..), sectionId, text (one explanatory sentence starting with a named character, not a pronoun), characterIds, locationId, eventIds, purpose (why it happens), transition (how it leads to the next beat).\n` +
      `5. knowledge: author (what only the author knows — twists, concealed identities), reader (what the reader learns by chapter end), characters (per character: knows / doesNotKnow at chapter end). Later reveals never appear in reader or character layers.\n` +
      `JSON: {"objective":"","keyPoints":[""],"conclusion":"","synopsis":"","cast":[{"id":"","name":"","role":"","pov":false}],"locations":[{"id":"l0","name":"","significance":""}],"events":[{"id":"e0","name":"","consequence":"","source":"chapter"}],"microbeats":[{"id":"m0","sectionId":"${i.details[0]?.id ?? `c${ch}s0`}","text":"","characterIds":[],"locationId":"l0","eventIds":[],"purpose":"","transition":""}],"knowledge":{"author":[],"reader":[],"characters":[{"characterId":"","knows":[],"doesNotKnow":[]}]},"castProposals":[{"id":"p0","name":"","role":"","justification":""}]}`,
  };
}

const PRONOUN_START = /^(he|she|they|him|her|them|his|hers|their|it)\b/i;

/** Deterministic validation: references, coverage, pronoun clarity, spoiler safety, no unapproved people. */
export function validateBlueprint(bp: ChapterBlueprint, i: Pick<BlueprintInput, "m" | "chapter" | "details" | "cast">): string[] {
  const issues: string[] = [];
  const ch = i.chapter.chapterIndex;
  if (!bp.synopsis) issues.push("synopsis is required");
  if (!bp.conclusion) issues.push("conclusion is required");
  if (!bp.keyPoints.length) issues.push("keyPoints are required");
  const castIds = new Set(i.cast.map((c) => c.id));
  const proposalIds = new Set(bp.castProposals.map((p) => p.id));
  for (const p of bp.castProposals) {
    if (!p.name || !p.justification) issues.push(`cast proposal ${p.id || "?"} needs a name and justification`);
    if (castIds.has(p.id)) issues.push(`cast proposal ${p.id} reuses an existing cast id`);
    const known = i.cast.find((c) => [c.name, ...(c.aliases ?? [])].some((n) => norm(n) === norm(p.name)));
    if (known) issues.push(`"${p.name}" is already in the cast as ${known.id}; use that id`);
  }
  const charIds = new Set(bp.cast.map((c) => c.id));
  for (const c of bp.cast) if (!castIds.has(c.id) && !proposalIds.has(c.id)) issues.push(`character ${c.id} (${c.name}) is not in the book cast or castProposals`);
  const locIds = new Set(bp.locations.map((l) => l.id));
  const evIds = new Set(bp.events.map((e) => e.id));
  const sectionIds = i.details.map((d) => d.id);
  for (const e of bp.events) {
    if (!(e.source === "master" || e.source === "chapter" || sectionIds.includes(e.source))) issues.push(`event ${e.id} must cite its approved source (master, chapter or a section id)`);
  }
  if (!bp.microbeats.length) issues.push("microbeats are required");
  const seenIds = new Set<string>();
  let lastSec = -1;
  const usedChars = new Set<string>(), usedLocs = new Set<string>(), usedEvents = new Set<string>();
  bp.microbeats.forEach((b, k) => {
    const tag = b.id || `beat ${k + 1}`;
    if (seenIds.has(b.id)) issues.push(`duplicate microbeat id ${b.id}`); seenIds.add(b.id);
    const si = sectionIds.indexOf(b.sectionId);
    if (si < 0) issues.push(`${tag}: unknown section ${b.sectionId}`);
    else { if (si < lastSec) issues.push(`${tag}: out of section order`); lastSec = Math.max(lastSec, si); }
    if (!b.text) issues.push(`${tag}: text is required`);
    if (!b.purpose) issues.push(`${tag}: purpose is required`);
    if (k < bp.microbeats.length - 1 && !b.transition) issues.push(`${tag}: transition to the next beat is required`);
    for (const c of b.characterIds) { if (!charIds.has(c)) issues.push(`${tag}: character ${c} not in chapter cast`); usedChars.add(c); }
    if (!locIds.has(b.locationId)) issues.push(`${tag}: unknown location ${b.locationId || "(none)"}`); else usedLocs.add(b.locationId);
    for (const e of b.eventIds) { if (!evIds.has(e)) issues.push(`${tag}: unknown event ${e}`); usedEvents.add(e); }
    if (b.characterIds.length && PRONOUN_START.test(b.text)) issues.push(`${tag}: starts with a pronoun; name the character`);
  });
  for (const s of sectionIds) if (!bp.microbeats.some((b) => b.sectionId === s)) issues.push(`section ${s} has no microbeats`);
  for (const c of bp.cast) if (!usedChars.has(c.id)) issues.push(`character ${c.id} participates in no microbeat`);
  for (const l of bp.locations) if (!usedLocs.has(l.id)) issues.push(`location ${l.id} is used by no microbeat`);
  for (const e of bp.events) if (!usedEvents.has(e.id)) issues.push(`event ${e.id} happens in no microbeat`);
  const est = expectedMicrobeats(i.chapter.targetWords);
  if (bp.microbeats.length < Math.ceil(est * 0.4)) issues.push(`only ${bp.microbeats.length} microbeats for ~${est} planned paragraphs; coverage is too thin`);
  if (bp.microbeats.length > est * 3) issues.push(`${bp.microbeats.length} microbeats is far more than ~${est} planned paragraphs`);
  for (const k of bp.knowledge.characters) if (!charIds.has(k.characterId)) issues.push(`knowledge for unknown character ${k.characterId}`);
  const secrets = futureSecrets(i.m.skeleton, ch);
  const writerFacing = [...bp.knowledge.reader, ...bp.knowledge.characters.flatMap((k) => k.knows), ...bp.microbeats.map((b) => b.text)].join("\n");
  for (const t of leaks(writerFacing, secrets)) issues.push(`a later reveal ("${t}") leaks into reader, character or microbeat text`);
  return issues;
}

export function parseBlueprint(raw: string, i: BlueprintInput): ParseResult<ChapterBlueprint> {
  let o: any;
  try { o = extractJson(raw); } catch (e) { return { ok: false, issues: [`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`] }; }
  if (!o || typeof o !== "object") return { ok: false, issues: ["Expected a JSON object"] };
  const bp: ChapterBlueprint = {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION, chapterIndex: i.chapter.chapterIndex,
    objective: str(o.objective) || i.chapter.objective, keyPoints: arr(o.keyPoints).map(str).filter(Boolean),
    conclusion: str(o.conclusion), synopsis: str(o.synopsis),
    cast: arr(o.cast).map((c) => ({ id: str(c?.id), name: str(c?.name), role: str(c?.role), pov: c?.pov === true })),
    locations: arr(o.locations).map((l) => ({ id: str(l?.id), name: str(l?.name), significance: str(l?.significance) })),
    events: arr(o.events).map((e) => ({ id: str(e?.id), name: str(e?.name), consequence: str(e?.consequence), source: str(e?.source) })),
    microbeats: arr(o.microbeats).map((b, k) => ({ id: str(b?.id) || `m${k}`, sectionId: str(b?.sectionId), order: k, text: str(b?.text),
      characterIds: arr(b?.characterIds).map(String), locationId: str(b?.locationId), eventIds: arr(b?.eventIds).map(String), purpose: str(b?.purpose), transition: str(b?.transition) })),
    knowledge: { author: arr(o.knowledge?.author).map(str).filter(Boolean), reader: arr(o.knowledge?.reader).map(str).filter(Boolean),
      characters: arr(o.knowledge?.characters).map((k) => ({ characterId: str(k?.characterId), knows: arr(k?.knows).map(str).filter(Boolean), doesNotKnow: arr(k?.doesNotKnow).map(str).filter(Boolean) })) },
    castProposals: arr(o.castProposals).map((p) => ({ id: str(p?.id), name: str(p?.name), role: str(p?.role), justification: str(p?.justification) })).filter((p) => p.id || p.name),
  };
  const issues = validateBlueprint(bp, i);
  return issues.length ? { ok: false, issues, value: bp } as ParseResult<ChapterBlueprint> : { ok: true, value: bp, issues: [] } as ParseResult<ChapterBlueprint>;
}

/** Free deterministic blueprint for test mode: built only from the approved plan, never invented. */
export function mockBlueprintOutput(i: BlueprintInput): string {
  const ch = i.chapter.chapterIndex;
  const people = i.cast.slice(0, 2);
  const est = expectedMicrobeats(i.chapter.targetWords);
  const per = Math.max(1, Math.ceil(est / Math.max(1, i.details.length)));
  const beats = i.details.flatMap((d, si) => Array.from({ length: per }, (_, k) => ({
    id: `m${si * per + k}`, sectionId: d.id, text: `${people[0]?.name ?? "The narrator"} ${k === 0 ? d.entry : k === per - 1 ? d.outcome : d.focus}`,
    characterIds: people.length ? [people[(k % people.length)].id].concat(people[0] ? [] : []) : [], locationId: "l0", eventIds: [`e${si}`], purpose: d.focus || "advance the section", transition: "leads into the next moment",
  })));
  if (people.length) for (const b of beats) b.text = `${people.find((p) => p.id === b.characterIds[0])?.name ?? people[0].name}: ${b.text.replace(/^\S+\s/, "")}`;
  return JSON.stringify({
    objective: i.chapter.objective, keyPoints: i.details.map((d) => d.focus), conclusion: i.details.at(-1)?.outcome ?? i.chapter.objective,
    synopsis: i.details.map((d) => `${d.entry} ${d.focus} ${d.outcome}`).join(" "),
    cast: people.map((p) => ({ id: p.id, name: p.name, role: "participant" })),
    locations: [{ id: "l0", name: "Chapter setting", significance: "where the chapter takes place" }],
    events: i.details.map((d, si) => ({ id: `e${si}`, name: d.focus, consequence: d.outcome, source: d.id })),
    microbeats: beats, knowledge: { author: [], reader: i.details.map((d) => d.outcome), characters: people.map((p) => ({ characterId: p.id, knows: [], doesNotKnow: [] })) },
    castProposals: [],
  });
  void ch;
}
