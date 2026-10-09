// Replaced technical artifacts (e.g. getUser() → fetchUser()). Pure, no I/O.
// The history is kept for continuity, but the legacy name is tagged in context and
// any reuse in new prose is caught deterministically by the continuity check.
import type { ContinuityIssue } from "./continuity.ts";

export interface Replacement { legacy: string; active: string; source: string }

const IDENT = "([A-Za-z_$][\\w$.]*(?:\\(\\))?)";
const PATTERNS: { re: RegExp; legacyIsName: boolean }[] = [
  { re: new RegExp(`\\b(?:replaces|replaced|supersedes|superseded|renamed from|formerly|previously)\\s+(?!by\\b)\`?${IDENT}`, "i"), legacyIsName: false },
  { re: new RegExp(`\\b(?:replaced by|superseded by|renamed to|deprecated in favou?r of|use instead)\\s+\`?${IDENT}`, "i"), legacyIsName: true },
];

const bare = (s: string) => s.replace(/`/g, "").replace(/\([^()]*\)$/, "").trim();
const call = (s: string) => `${bare(s)}()`;

/** Reads replacement relations from artifact names + descriptions. */
export function parseReplacements(entities: readonly { name: string; description?: string | null; source?: string }[]): Replacement[] {
  const out = new Map<string, Replacement>();
  for (const e of entities) {
    const d = e.description ?? "";
    for (const { re, legacyIsName } of PATTERNS) {
      const m = d.match(re);
      if (!m) continue;
      const other = bare(m[1]);
      const [legacy, active] = legacyIsName ? [bare(e.name), other] : [other, bare(e.name)];
      if (!legacy || !active || legacy === active) continue;
      out.set(legacy, { legacy, active, source: e.source ?? e.name });
    }
  }
  return [...out.values()];
}

export const replacementTag = (r: Replacement) => `[REPLACED — DO NOT USE: ${call(r.legacy)}] (Active replacement: ${call(r.active)})`;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Sentences that explicitly talk about the replacement are legitimate history, not reuse.
const HISTORICAL = /\b(replaced|deprecated|renamed|formerly|previously|no longer|instead of|used to be|old name|legacy)\b/i;

/** Every non-historical use of a legacy name in the section, as a repairable continuity issue. */
export function findDeprecatedUses(text: string, reps: readonly Replacement[]): ContinuityIssue[] {
  const issues: ContinuityIssue[] = [];
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  for (const r of reps) {
    const re = new RegExp(`(?<![\\w$.])${esc(r.legacy)}(?![\\w$])`);
    const hit = sentences.find((s) => re.test(s) && !HISTORICAL.test(s));
    if (!hit) continue;
    issues.push({
      type: "TERMINOLOGY_INCONSISTENCY", classification: "ERROR", severity: "HIGH", confidence: 0.98,
      excerpt: hit.trim().slice(0, 300), conflictingEvidence: replacementTag(r),
      sourceChapter: null, sourceSubsection: null, entity: r.legacy, authority: "APPROVED_GENERATED_STATE",
      explanation: `${call(r.legacy)} was replaced by ${call(r.active)} earlier in the book.`,
      repairable: true, suggestedResolution: `Use ${call(r.active)} instead of ${call(r.legacy)}.`,
    });
  }
  return issues;
}
