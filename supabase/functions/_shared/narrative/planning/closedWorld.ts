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
  const timeRefs = (bp.timeRefs ?? []).filter((t) => t.sectionIndex === sectionIndex);
  const timeLines = timeRefs.length
    ? ["Approved time references for this section (weave each phrase in verbatim, at natural moments — sensory shifts, action beats — never as an opening timestamp; keep every stated time consistent with earlier sections):",
      ...timeRefs.map((t) => `- "${t.phrase}" (${t.kind})`)]
    : [];
  return [
    "APPROVED CHAPTER BLUEPRINT (closed world):",
    `Objective: ${bp.objective}`,
    `Allowed people: ${bp.cast.map((c) => c.name).join(", ") || "none"}`,
    `Allowed places: ${bp.locations.map((l) => l.name).join(", ") || "none"}`,
    ...timeLines,
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

// ── Stage 5: versioned plan amendments + emergent characters ──
export interface BlueprintAmendment { kind: "person" | "place"; name: string; reason: string }
export interface AmendmentLogEntry { at: string; fromVersion: number | null; changes: BlueprintAmendment[] }

/** Returns a NEW blueprint (never mutates the approved one). People become cast proposals (author must
 * approve them into the cast; reference images follow), places are added directly. Duplicates are skipped. */
export function amendBlueprint(bp: ChapterBlueprint, changes: readonly BlueprintAmendment[], fromVersion: number | null, at = new Date().toISOString()): ChapterBlueprint & { amendments: AmendmentLogEntry[] } {
  const next = JSON.parse(JSON.stringify(bp)) as ChapterBlueprint & { amendments?: AmendmentLogEntry[] };
  const has = (list: { name: string }[], n: string) => list.some((x) => x.name.toLowerCase() === n.toLowerCase());
  const applied: BlueprintAmendment[] = [];
  for (const c of changes) {
    const name = c.name.trim().slice(0, 200); if (!name) continue;
    if (c.kind === "person") {
      if (has(next.cast, name) || has(next.castProposals, name)) continue;
      next.castProposals.push({ id: `amend-${next.castProposals.length + 1}`, name, role: "emergent", justification: c.reason.slice(0, 500) });
    } else {
      if (has(next.locations, name)) continue;
      next.locations.push({ id: `amend-l${next.locations.length + 1}`, name, significance: c.reason.slice(0, 500) });
    }
    applied.push({ ...c, name });
  }
  next.amendments = [...(next.amendments ?? []), ...(applied.length ? [{ at, fromVersion, changes: applied }] : [])];
  return next as ChapterBlueprint & { amendments: AmendmentLogEntry[] };
}

/** Emergent-character universe collision: an exact or first/last-name match in another book of the same universe. */
export function universeCollisions(name: string, others: readonly { name: string; bookTitle?: string }[]): string[] {
  const toks = name.toLowerCase().split(/\s+/).filter(Boolean);
  return others.filter((o) => {
    const ot = o.name.toLowerCase().split(/\s+/).filter(Boolean);
    if (ot.join(" ") === toks.join(" ")) return true;
    return toks.length === 1 && ot.includes(toks[0]);
  }).map((o) => `${o.name}${o.bookTitle ? ` (${o.bookTitle})` : ""}`);
}

// ── Title / theme invariance ──
export const titleThemeLock = (title: string, premise = ""): string =>
  `The book's title is "${title.trim()}" and must not be renamed, retitled or reinterpreted.${premise ? ` Its central theme and premise stay exactly: ${premise.trim()}` : ""} Every chapter, section and beat must serve this theme.`;

// ── Appearance contradictions against locked character cards ──
const COLORS = ["black","brown","blue","green","grey","gray","hazel","amber","red","auburn","blonde","blond","golden","white","silver","copper","violet","dark","pale"];
const PARTS = ["eyes","hair","beard","skin"];
export interface LockedLook { name: string; features: Record<string, string>; locked: boolean }
export function appearanceContradictions(text: string, cards: readonly LockedLook[]): Finding[] {
  const out: Finding[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const c of cards) {
    if (!c.locked) continue;
    const first = c.name.split(/\s+/)[0];
    for (const part of PARTS) {
      const lockedVal = Object.entries(c.features).find(([k]) => k.toLowerCase().includes(part.replace(/s$/, "")))?.[1]?.toLowerCase();
      if (!lockedVal) continue;
      const lockedColors = COLORS.filter((col) => lockedVal.includes(col));
      if (!lockedColors.length) continue;
      for (const sen of sentences) {
        if (!new RegExp(`\\b${first}\\b`).test(sen)) continue;
        const others = sentences.length && cards.some((o) => o !== c && new RegExp(`\\b${o.name.split(/\s+/)[0]}\\b`).test(sen));
        if (others) continue; // ambiguous sentence: skip rather than guess
        const m = sen.toLowerCase().match(new RegExp(`\\b(${COLORS.join("|")})(?:[- ]\\w+)?\\s+${part}\\b`));
        if (m && !lockedColors.includes(m[1]) && !(m[1] === "gray" && lockedColors.includes("grey")) && !(m[1] === "grey" && lockedColors.includes("gray"))) {
          out.push({ code: "APPEARANCE_CONTRADICTION", category: "continuity", severity: "material", canonKind: "identity", repairable: true, excerpt: sen.trim().slice(0, 300),
            message: `${c.name}'s locked ${part} are "${lockedVal}", but the draft says "${m[0]}".` });
        }
      }
    }
  }
  return out;
}

/** Introduction/re-entry exposure: how many locked features a section shows for a character. */
export function exposedFeatures(text: string, card: LockedLook): string[] {
  const low = text.toLowerCase();
  return Object.values(card.features).filter((v) => {
    const words = v.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
    return words.length > 0 && words.filter((w) => low.includes(w)).length >= Math.ceil(words.length / 2);
  });
}
export function reentryFinding(text: string, card: LockedLook, range: [number, number]): Finding[] {
  if (!new RegExp(`\\b${card.name.split(/\s+/)[0]}\\b`).test(text)) return [];
  const n = exposedFeatures(text, card).length;
  return n < range[0] ? [{ code: "REENTRY_CUES_LOW", category: "writing_quality", severity: "minor", repairable: false,
    message: `${card.name} returns with ${n} recognisable appearance cue(s); ${range[0]}–${range[1]} expected.` }] : [];
}

// ── Event / thread deadlines ──
export interface ThreadDeadline { name: string; due: string; resolved?: boolean }
export function deadlineFindings(deadlines: readonly ThreadDeadline[], sceneDate: string | null): Finding[] {
  if (!sceneDate) return [];
  return deadlines.filter((d) => !d.resolved && d.due < sceneDate).map((d) => ({
    code: "THREAD_DEADLINE_PASSED", category: "continuity" as const, severity: "moderate" as const, repairable: false,
    message: `"${d.name}" was due by ${d.due}, but the story is now at ${sceneDate} and it is not resolved.` }));
}
