// Stage 3 + 4 closed-world writing: the writer receives the approved chapter blueprint for its section,
// and the pre-acceptance pass flags capitalised names that are neither planned nor established.
import type { ChapterBlueprint } from "./blueprint.ts";
import type { Finding } from "./validation.ts";

/** Stage 3: section-scoped blueprint brief. Missing blueprint → empty string (gate already enforced). */
export function renderBlueprintBrief(bp: ChapterBlueprint | null | undefined, sectionIndex: number): string {
  if (!bp) return "";
  const beats = bp.microbeats.filter((b) => b.sectionId === String(sectionIndex) || b.sectionId.endsWith(`s${sectionIndex}`) || b.sectionId.endsWith(`-${sectionIndex}`));
  const use = beats.length ? beats : bp.microbeats;
  const name = new Map(bp.cast.map((c) => [c.id, c.name]));
  const loc = new Map(bp.locations.map((l) => [l.id, l.name]));
  const lines = [...use].sort((a, b) => a.order - b.order).map((b, i) =>
    `${i + 1}. ${b.text} [with: ${b.characterIds.map((id) => name.get(id) ?? id).join(", ") || "none"}; at: ${loc.get(b.locationId) ?? "unspecified"}]`);
  return [
    "APPROVED CHAPTER BLUEPRINT (closed world):",
    `Objective: ${bp.objective}`,
    `Allowed people: ${bp.cast.map((c) => c.name).join(", ") || "none"}`,
    `Allowed places: ${bp.locations.map((l) => l.name).join(", ") || "none"}`,
    "Microbeats for this section, in order:",
    ...lines,
    "Do not introduce any named person, place or event not listed above or already established. If a beat cannot be written without missing information, write around it and do not invent the missing fact.",
  ].join("\n");
}

const STOP = new Set(("I A The An And But Or So Then When While If He She They We You It His Her Their Our My Your Its This That These Those There Here What Who Why How Where " +
  "Mr Mrs Ms Dr Sir Lady Lord Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December " +
  "God Yes No Oh Okay OK Not Now After Before Still Even Just Maybe Perhaps Every Each Some Nothing Something Everyone Someone Chapter Section").split(" "));

/** Stage 4: names (capitalised, not sentence-initial) absent from every known source. */
export function findUnplannedNames(text: string, known: readonly string[], ignore: readonly string[] = []): Finding[] {
  const allow = new Set<string>();
  for (const k of [...known, ...ignore]) for (const t of k.split(/[\s'’-]+/)) if (t) allow.add(t.toLowerCase());
  const counts = new Map<string, number>();
  const re = /(?<![.!?"“]\s)(?<!^)\b([A-Z][a-z]{2,})\b/gm;
  for (const para of text.split(/\n+/)) {
    for (const m of para.matchAll(re)) {
      const w = m[1]; const idx = m.index ?? 0;
      const before = para.slice(Math.max(0, idx - 3), idx);
      if (idx === 0 || /[.!?:"“‘]\s*$/.test(before) || STOP.has(w) || allow.has(w.toLowerCase())) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, n]) => n >= 2).map(([w]) => ({
    code: "UNPLANNED_ENTITY", category: "continuity" as const, severity: "moderate" as const, repairable: false, excerpt: w,
    message: `"${w}" is not in the approved blueprint, cast or story memory. Add it to the plan or remove it.`,
  }));
}

/** Known vocabulary from a blueprint plus established names. */
export const blueprintKnownNames = (bp: ChapterBlueprint | null | undefined, established: readonly string[] = []): string[] =>
  [...(bp?.cast.map((c) => c.name) ?? []), ...(bp?.locations.map((l) => l.name) ?? []), ...(bp?.events.map((e) => e.name) ?? []), ...established];
