// Stage 2 — Detailed chapter narrative blueprints. Pure, no I/O.
// A blueprint expands an expanded chapter (+ its section plans and beats) into a flowing synopsis,
// the chapter's cast / locations / events with stable ids, and ordered microbeats that reference
// them. It is a PLANNED progressive plan row (level BLUEPRINT) until the author approves it (READY).
// Not wired to prose generation (Stage 3). Planner sees the whole book; writer-facing layers
// (reader knowledge, character knowledge) must never carry later reveal secrets.
import type { ChapterPlan, ChapterTimeRef, MasterPlanSkeleton } from "./engine.ts";
import type { MasterContext, ParseResult, Prompt, SectionDetail, BeatNote } from "./aiPlanning.ts";
import { extractJson, renderWholeBook } from "./aiPlanning.ts";

/** Generic instructional participants are plan-local roles, never story identities.
 * Unknown adapters and narrative books remain fail-closed for all proposed people. */
const ROLE_WORDS = /^(reader|learner|student|customer|client|employee|manager|cook|user|practitioner|colleague|coworker|co-worker|friend|partner|spouse|parent|child|boss|supervisor|team|teammate|neighbo(u)?r|mentor|coach|founder|investor|owner|buyer|seller|beginner|novice|expert|person|someone|participant|patient|guest|host|stakeholder|lead|peer|reviewer|writer|speaker|listener|audience|example|you)$/i;
const ROLE_SUFFIX = /(er|or|ist|ant|ent|ee|ian)$/i;
/** Generic instructional roles ("Report writer", "Colleague", "A new manager") — never a named person. */
export function isBlueprintExampleRole(name: string, adapter?: string): boolean {
  if (!["self_help", "business", "finance", "cookbook", "technical"].includes(adapter ?? "")) return false;
  const toks = name.trim().replace(/^(the|a|an|your|my)\s+/i, "").split(/\s+/).filter(Boolean);
  if (!toks.length || toks.length > 4) return false;
  // Any capitalised token after the first looks like a proper name ("Omar Reyes", "Dr Lee").
  if (toks.slice(1).some((t) => /^\p{Lu}/u.test(t))) return false;
  if (/^(mr|mrs|ms|dr|prof|sir|lady|lord)\.?$/i.test(toks[0])) return false;
  const head = toks[toks.length - 1];
  if (toks.length === 1) return ROLE_WORDS.test(head);
  return ROLE_WORDS.test(head) || ROLE_SUFFIX.test(head);
}

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
  /** Approved chapter time references, copied from the chapter plan (never model output). */
  timeRefs?: ChapterTimeRef[];
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
    const si = chapter.sections.find((s) => s.id === d.id)?.sectionIndex;
    const time = (chapter.timeRefs ?? []).filter((t) => t.sectionIndex === si).map((t) => `"${t.phrase}" (${t.kind})`);
    return `- ${d.id}: opens ${d.entry} | turns on ${d.focus} | ends ${d.outcome}${beats ? ` | beats: ${beats}` : ""}${time.length ? ` | time: ${time.join(", ")}` : ""}`;
  }).join("\n");
  const timeRule = (chapter.timeRefs ?? []).length
    ? `\n6. Time references are binding: each microbeat covering a moment with an approved time phrase must quote that phrase verbatim in its text. Spread them so the reader always knows how much time has passed; never drop, reword or relocate one.\n`
    : "";
  const cast = i.cast.map((c) => `- ${c.id}: ${c.name}${c.aliases?.length ? ` (also ${c.aliases.join(", ")})` : ""}`).join("\n") || "- (no cast recorded yet)";
  return {
    system: "You are a book planner. You expand ONE approved chapter into a detailed narrative blueprint. You never invent developments outside the approved plan. Output JSON only.",
    user: `${renderWholeBook(m, { ...i.expanded, [ch]: chapter })}\n\n` +
      `CHAPTER ${ch + 1} — objective: ${chapter.objective}${i.stakes ? `\nStakes: ${i.stakes}` : ""}${i.focus ? `\nFocus: ${i.focus}` : ""}\nAbout ${chapter.targetWords} words.\nApproved sections:\n${sec}\n\n` +
      `Book cast (use these ids; never create a person outside this list — if the approved plan truly needs someone new, add them to castProposals with a justification and use the proposal id):\n${cast}\n\n` +
      (isBlueprintExampleRole("Reader", m.skeleton.adapter) ? `Generic instructional roles such as Reader or Bill payer are plan-local example participants, not new people: put them in cast with local ids, never castProposals. Named people still require a proposal.\n` : "") +
      `Write the blueprint:\n` +
      `1. keyPoints and conclusion must preserve the chapter's approved objective, plot direction and ending.\n` +
      `2. synopsis: a flowing prose account of the whole chapter from opening to conclusion — as long as completeness needs; no word limit. Names may repeat; every pronoun must be unambiguous.\n` +
      `3. cast / locations / events: every participating character, consequential place and significant event, each with a stable id (locations l0.., events e0..). Every event names its source in the approved plan: "master", "chapter" or a section id.\n` +
      `4. microbeats: about ${est} ordered units (roughly one per planned paragraph; more or fewer where the story needs it), covering every section in order. Each: id (m0..), sectionId, text (one explanatory sentence starting with a named character, not a pronoun), characterIds, locationId, eventIds, purpose (why it happens), transition (how it leads to the next beat).\n` +
      `5. knowledge: author (what only the author knows — twists, concealed identities), reader (what the reader learns by chapter end), characters (per character: knows / doesNotKnow at chapter end). Later reveals never appear in reader or character layers.\n` +
      timeRule +
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
  for (const c of bp.cast) if (!castIds.has(c.id) && !proposalIds.has(c.id) && !isBlueprintExampleRole(c.name, i.m.skeleton.adapter)) issues.push(`character ${c.id} (${c.name}) is not in the book cast or castProposals`);
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
  // Approved time references must survive into the microbeats verbatim — never dropped, reworded or moved.
  for (const t of i.chapter.timeRefs ?? []) {
    const secId = i.details.find((d, di) => (i.chapter.sections[di]?.sectionIndex ?? di) === t.sectionIndex)?.id;
    const beats = bp.microbeats.filter((b) => b.sectionId === secId);
    const hay = beats.map((b) => b.text).join(" ").toLowerCase();
    if (!hay.includes(t.phrase.toLowerCase()))
      issues.push(`time reference "${t.phrase}" must appear verbatim in a microbeat of section ${secId ?? t.sectionIndex}`);
  }
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
    timeRefs: i.chapter.timeRefs,
  };
  const issues = validateBlueprint(bp, i);
  return issues.length ? { ok: false, issues } : { ok: true, value: bp };
}

/** Free deterministic blueprint for test mode: built only from the approved plan, never invented. */
export function mockBlueprintOutput(i: BlueprintInput): string {
  const people = i.cast.slice(0, 2);
  const est = expectedMicrobeats(i.chapter.targetWords);
  const per = Math.max(1, Math.ceil(est / Math.max(1, i.details.length)));
  const beats = i.details.flatMap((d, si) => Array.from({ length: per }, (_, k) => ({
    id: `m${si * per + k}`, sectionId: d.id, text: `${people[0]?.name ?? "The narrator"} ${k === 0 ? d.entry : k === per - 1 ? d.outcome : d.focus}`,
    characterIds: people.length ? [people[k % people.length].id] : [], locationId: "l0", eventIds: [`e${si}`], purpose: d.focus || "advance the section", transition: "leads into the next moment",
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
}

// ---------- Stage 2 completion: authority rules (pure) ----------
/**
 * Detailed-blueprint workflow is explicit per book: `controls.blueprint_mode = "required"`.
 * Books that turn Progressive Planning on get it; older Progressive books keep their current
 * behaviour until the author opts in (non-destructive compatibility). Standard books never see it.
 */
export type BlueprintMode = "required" | "off";
export const resolveBlueprintMode = (controls: unknown): BlueprintMode => {
  const c = (controls ?? {}) as Record<string, unknown>;
  return c.planning_pipeline === "progressive" && c.blueprint_mode === "required" ? "required" : "off";
};

/** Proposed new people not yet registered in the book's master cast. Listing someone never authorizes them. */
export function pendingCastProposals(bp: Pick<ChapterBlueprint, "castProposals"> | null | undefined, cast: readonly CastRef[], adapter?: string): CastProposal[] {
  const names = new Set(cast.flatMap((c) => [c.name, ...(c.aliases ?? [])]).map(norm));
  return (bp?.castProposals ?? []).filter((p) => !names.has(norm(p.name)) && !isBlueprintExampleRole(p.name, adapter));
}

/** Plan rows a bulk "approve all" may approve: never blueprints (each needs its own review). */
export const bulkApprovableIds = (rows: readonly { id: string; plan_status: string; plan_level: string }[]) =>
  rows.filter((r) => r.plan_status === "PLANNED" && r.plan_level !== "BLUEPRINT").map((r) => r.id);

/** Why a blueprint may not be approved yet (empty = approvable). */
export function blueprintApprovalIssues(bp: ChapterBlueprint | null | undefined, cast: readonly CastRef[], adapter?: string): string[] {
  if (!bp) return ["blueprint content is missing"];
  return pendingCastProposals(bp, cast, adapter).map((p) => `"${p.name}" must be approved and added to the book's cast first`);
}

export type BlueprintGate = { ok: true; blueprint: ChapterBlueprint | null; planId: string | null; version: number | null }
  | { ok: false; code: "BLUEPRINT_REQUIRED" | "CAST_APPROVAL_REQUIRED"; reason: string };

/** Writing gate for required-blueprint books: the chapter needs an approved blueprint whose people are all registered. */
export function blueprintGate(mode: BlueprintMode, rows: readonly { id: string; plan_status: string; version?: number; content?: any }[], ch: number, cast: readonly CastRef[], adapter?: string): BlueprintGate {
  if (mode !== "required") return { ok: true, blueprint: null, planId: null, version: null };
  const ready = rows.filter((r) => r.plan_status === "READY").sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))[0];
  const bp = ready?.content?.blueprint as ChapterBlueprint | undefined;
  if (!ready || !bp) return { ok: false, code: "BLUEPRINT_REQUIRED", reason: `Chapter ${ch + 1} needs an approved detailed blueprint before it can be written.` };
  const pending = pendingCastProposals(bp, cast, adapter);
  if (pending.length) return { ok: false, code: "CAST_APPROVAL_REQUIRED", reason: `Approve and add to the cast first: ${pending.map((p) => p.name).join(", ")}.` };
  return { ok: true, blueprint: bp, planId: ready.id, version: Number(ready.version ?? 1) };
}
