// Phase 2 — reusable contract for AI Generate and Hybrid persona creation (pure).
// The same prompt builder, parser and author-fact protection run for mocked (Phase 2)
// and live model responses; only the caller injected by the server differs.
import type { ApproximateDate } from "./chronology.ts";

/** Enduring expertise / genre domain of a persona (never a story role). */
export const PERSONA_DOMAINS = [
  "business", "finance", "medicine", "law", "politics", "science", "technology", "mystery",
  "crime", "espionage", "military", "romance", "arts", "academia", "faith", "sports", "trades", "general",
] as const;
export type PersonaDomain = typeof PERSONA_DOMAINS[number];

/** How a character functions inside one specific book. */
export const NARRATIVE_ROLES = [
  "protagonist", "antagonist", "primary_narrator", "deuteragonist", "mentor", "foil",
  "love_interest", "catalyst", "supporting", "minor",
] as const;
export type NarrativeRole = typeof NARRATIVE_ROLES[number];

export const PERSONA_FIELDS = [
  "displayName", "aliases", "birthDate", "deathDate", "coreValues", "flaw", "fear",
  "motivation", "contradiction", "voiceSample", "backstory", "milestones",
] as const;
export type PersonaField = typeof PERSONA_FIELDS[number];

export interface AuthorFact { field: PersonaField; value: unknown }

export interface PersonaGenerationRequest {
  mode: "ai_generate" | "hybrid";
  domain: PersonaDomain;
  seed: string;
  authorFacts: AuthorFact[];
}

export interface PersonaSuggestion {
  field: PersonaField;
  value: unknown;
  rationale: string;
  status: "suggested" | "accepted" | "discarded";
}

export interface PersonaDraft {
  displayName: string;
  domain: PersonaDomain;
  suggestions: PersonaSuggestion[];
  /** Fields the model tried to change although the author fixed them — dropped, reported. */
  rejectedOverrides: PersonaField[];
}

const isField = (f: unknown): f is PersonaField => typeof f === "string" && (PERSONA_FIELDS as readonly string[]).includes(f);
export const isDomain = (d: unknown): d is PersonaDomain => typeof d === "string" && (PERSONA_DOMAINS as readonly string[]).includes(d);
export const isRole = (r: unknown): r is NarrativeRole => typeof r === "string" && (NARRATIVE_ROLES as readonly string[]).includes(r);

export function buildPersonaPrompt(req: PersonaGenerationRequest): { system: string; user: string } {
  const facts = req.authorFacts.length
    ? req.authorFacts.map((f) => `- ${f.field}: ${JSON.stringify(f.value)}`).join("\n")
    : "(none)";
  return {
    system: [
      "You design persistent fictional personas for an author. Return JSON only:",
      '{"displayName": string, "suggestions": [{"field": one of ' + JSON.stringify(PERSONA_FIELDS) + ', "value": any, "rationale": string}]}',
      "Dates use {precision:'exact'|'month_year'|'year'|'approximate'|'range'|'unknown', year?, month?, day?}.",
      "AUTHOR FACTS ARE FIXED. Never suggest a value for a field the author set, and never contradict them.",
      "The persona has a domain of expertise, not a story role; do not label them protagonist/antagonist.",
    ].join("\n"),
    user: `Mode: ${req.mode}\nDomain: ${req.domain}\nConcept: ${req.seed.slice(0, 2000)}\nAuthor facts:\n${facts}`,
  };
}

/** Parse model output, then strip anything that would overwrite an author fact. */
export function parsePersonaOutput(raw: string, req: PersonaGenerationRequest): { ok: true; draft: PersonaDraft } | { ok: false; error: string } {
  let obj: any;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    obj = JSON.parse(m ? m[0] : raw);
  } catch {
    return { ok: false, error: "INVALID_JSON" };
  }
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.suggestions)) return { ok: false, error: "MISSING_SUGGESTIONS" };
  const fixed = new Set(req.authorFacts.map((f) => f.field));
  const authorName = req.authorFacts.find((f) => f.field === "displayName")?.value;
  const rejected = new Set<PersonaField>();
  const suggestions: PersonaSuggestion[] = [];
  for (const s of obj.suggestions) {
    if (!s || !isField(s.field)) continue;
    if (fixed.has(s.field)) { rejected.add(s.field); continue; }
    suggestions.push({ field: s.field, value: s.value, rationale: String(s.rationale ?? "").slice(0, 500), status: "suggested" });
  }
  const modelName = typeof obj.displayName === "string" ? obj.displayName.trim() : "";
  if (typeof authorName === "string" && modelName && modelName !== authorName) rejected.add("displayName");
  const displayName = typeof authorName === "string" && authorName.trim() ? authorName.trim() : modelName;
  if (!displayName) return { ok: false, error: "MISSING_NAME" };
  return { ok: true, draft: { displayName, domain: req.domain, suggestions, rejectedOverrides: [...rejected] } };
}

/** Deterministic zero-cost stand-in for the model (Phase 2 testing). Deliberately tries to
 *  override author facts so the protection path is exercised every time. */
export function mockPersonaModel(req: PersonaGenerationRequest): string {
  const seedWord = (req.seed.match(/[A-Za-z]{4,}/)?.[0] ?? "Ash").replace(/^./, (c) => c.toUpperCase());
  const birth: ApproximateDate = { precision: "year", year: 1970 + (req.seed.length % 25) };
  return JSON.stringify({
    displayName: `${seedWord} Varden`,
    suggestions: [
      { field: "displayName", value: `${seedWord} Varden`, rationale: "Name echoing the concept" },
      { field: "birthDate", value: birth, rationale: "Places career peak in the present day" },
      { field: "coreValues", value: ["loyalty", "precision"], rationale: `Typical of the ${req.domain} domain` },
      { field: "flaw", value: "Cannot delegate", rationale: "Creates friction with allies" },
      { field: "fear", value: "Being made irrelevant", rationale: "Drives risky choices" },
      { field: "motivation", value: "Prove an early failure was not their fault", rationale: "Long-running arc" },
      { field: "voiceSample", value: "\"Numbers don't lie. People do, constantly.\"", rationale: "Clipped, dry cadence" },
      { field: "backstory", value: `Rose through ${req.domain} after a public setback.`, rationale: "Grounds expertise" },
    ],
  });
}

import { checkOrder, validateMilestones, type Milestone } from "./chronology.ts";

export interface LifeMilestone { key: string; label?: string; date: ApproximateDate | null; requires?: string[] }
export interface LifeFinding { key: string; against: string; verdict: "violation" | "uncertain" }

/** Back-check a persona's life: birth ≤ every milestone ≤ death, plus declared prerequisites.
 *  Violations block saving; uncertain overlaps are returned for the author to review. */
export function checkLifeChronology(birth: ApproximateDate | null | undefined, death: ApproximateDate | null | undefined, milestones: LifeMilestone[] = []): LifeFinding[] {
  const out: LifeFinding[] = [];
  const push = (key: string, against: string, v: string) => { if (v === "violation" || v === "uncertain") out.push({ key, against, verdict: v }); };
  if (birth && death) push("death", "birth", checkOrder(birth, death));
  for (const m of milestones) {
    if (birth) push(m.key, "birth", checkOrder(birth, m.date));
    if (death) push(m.key, "death", checkOrder(m.date, death));
  }
  for (const f of validateMilestones(milestones as Milestone[])) out.push({ key: f.key, against: f.requires, verdict: f.verdict });
  return out;
}
