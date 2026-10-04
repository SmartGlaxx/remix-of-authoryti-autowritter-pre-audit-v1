// Phase 2B: pure identity & artifact integrity. No I/O, no model calls, not wired to
// live generation. The model may PROPOSE entities/facts; only the application commits.
import { toPosition, normText, type StoryPosition } from "./rules.ts";

export type EntityKind = "person" | "organization" | "place" | "object" | "framework" | "claim" | "definition" | "artifact" | "recipe" | "other";

/** Evidence attributes compared during resolution. Values are normalized free text. */
export type Attributes = Partial<Record<"role" | "occupation" | "location" | "relationship" | "description" | "version" | "signature" | "language" | "quantity" | "unit", string>>;

export interface VersionedValue {
  value: string;
  /** Position from which this value is true. */
  effectiveAt: StoryPosition;
  source: string;
  authority: "USER_CANON" | "OUTLINE_CANON" | "APPROVED_GENERATED_STATE" | "AI_INFERENCE";
  evidence: string;
  /** Section that committed it — used to undo on regeneration. */
  sourceSectionKey: string;
  supersededAt?: StoryPosition | null;
}

export interface RegistryEntity {
  id: string; // identity ≠ name
  kind: EntityKind;
  name: string;
  aliases: string[];
  introducedAt: StoryPosition;
  /** Attribute history: attribute → versions (append-only). */
  history: Partial<Record<keyof Attributes, VersionedValue[]>>;
  /** Related entity ids, e.g. artifact dependencies or relationship partners. */
  relatedIds?: string[];
}

export interface Reference {
  surface: string; // e.g. "John", "Michael's childhood companion"
  kind?: EntityKind;
  attributes?: Attributes;
  relatedIds?: string[];
  /** Explicit statement in text that this is a reveal/change, if any. */
  revealEvidence?: string;
  material: boolean; // affects plot, argument, numbers or code
}

export type Classification = "EXISTING_ENTITY" | "NEW_ENTITY" | "ALIAS" | "POSSIBLE_DUPLICATE" | "CONFLICT" | "AMBIGUOUS";
export type Severity = "OK" | "WARNING" | "NEEDS_REVIEW" | "BLOCK";

export interface Resolution {
  classification: Classification;
  entityId: string | null; // never assigned on AMBIGUOUS / POSSIBLE_DUPLICATE
  candidates: { id: string; score: number; reasons: string[] }[];
  severity: Severity;
  conflicts: { attribute: string; established: string; proposed: string }[];
  reason: string;
}

const before = (a: StoryPosition, b: StoryPosition) => toPosition(a) <= toPosition(b);

/** Point-in-time attribute value: never leaks later state. */
export function attributeAt(e: RegistryEntity, attr: keyof Attributes, pos: StoryPosition): string | null {
  const vs = (e.history[attr] ?? []).filter((v) => before(v.effectiveAt, pos));
  if (!vs.length) return null;
  vs.sort((a, b) => toPosition(b.effectiveAt) - toPosition(a.effectiveAt));
  return vs[0].value;
}

/** Registry as visible at a position (entities introduced later are invisible). */
export function registryAt(reg: readonly RegistryEntity[], pos: StoryPosition): RegistryEntity[] {
  return reg.filter((e) => before(e.introducedAt, pos));
}

const nameTokens = (s: string) => normText(s).replace(/[^a-z0-9\s'-]/g, "").split(" ").filter(Boolean);

function nameMatch(e: RegistryEntity, surface: string): "exact" | "alias" | "none" {
  const s = normText(surface);
  if (normText(e.name) === s) return "exact";
  if (e.aliases.some((a) => normText(a) === s)) return "alias";
  return "none";
}

/** Weak signal only: shared non-trivial token (e.g. "Acme" in "Acme Corp" vs "Acme Inc"). */
function partialName(e: RegistryEntity, surface: string): boolean {
  const stop = new Set(["the", "a", "of", "inc", "corp", "ltd", "llc", "co", "mr", "mrs", "dr"]);
  const t = new Set(nameTokens(surface).filter((x) => !stop.has(x) && x.length > 2));
  return [e.name, ...e.aliases].some((n) => nameTokens(n).some((x) => t.has(x)));
}

/**
 * Evidence-based scoring. Similarity of a single descriptive phrase is NOT enough:
 * a non-name reference needs ≥2 independent agreeing attributes and zero contradictions.
 */
function score(e: RegistryEntity, ref: Reference, pos: StoryPosition) {
  const reasons: string[] = [];
  const conflicts: Resolution["conflicts"] = [];
  let s = 0;
  const nm = nameMatch(e, ref.surface);
  if (nm === "exact") { s += 3; reasons.push("name"); }
  else if (nm === "alias") { s += 3; reasons.push("verified alias"); }
  else if (partialName(e, ref.surface)) { s += 1; reasons.push("partial name"); }
  if (ref.kind && ref.kind !== e.kind) return { s: -99, reasons: ["kind mismatch"], conflicts, agreeing: 0, nm };
  let agreeing = 0;
  for (const [k, v] of Object.entries(ref.attributes ?? {}) as [keyof Attributes, string][]) {
    const est = attributeAt(e, k, pos);
    if (est == null || !v) continue;
    if (normText(est) === normText(v)) { s += 1.5; agreeing++; reasons.push(k); }
    else { s -= 2; conflicts.push({ attribute: k, established: est, proposed: v }); }
  }
  for (const r of ref.relatedIds ?? []) if (e.relatedIds?.includes(r)) { s += 1; agreeing++; reasons.push(`related:${r}`); }
  return { s, reasons, conflicts, agreeing, nm };
}

/** Pre-generation and post-generation resolution share one rule set. Never guesses. */
export function resolveReference(registry: readonly RegistryEntity[], ref: Reference, pos: StoryPosition): Resolution {
  const visible = registryAt(registry, pos);
  const scored = visible.map((e) => ({ e, ...score(e, ref, pos) })).filter((x) => x.s > -99);
  const named = scored.filter((x) => x.nm !== "none");
  const sev = (material: boolean, hi: Severity): Severity => (material ? hi : "WARNING");
  const cands = scored.filter((x) => x.s > 0 || x.nm !== "none").sort((a, b) => b.s - a.s)
    .map((x) => ({ id: x.e.id, score: x.s, reasons: x.reasons }));

  // Same surface name on several entities: needs distinguishing evidence.
  if (named.length > 1) {
    const ranked = [...named].sort((a, b) => b.s - a.s);
    const [top, next] = ranked;
    const decisive = top.agreeing >= 1 && top.conflicts.length === 0 && top.s - next.s >= 1.5;
    if (!decisive) return { classification: "AMBIGUOUS", entityId: null, candidates: cands, severity: sev(ref.material, "BLOCK"), conflicts: [], reason: `"${ref.surface}" matches ${named.length} entities without distinguishing evidence` };
    return finalizeMatch(top.e, top.nm, top.conflicts, ref, cands);
  }
  if (named.length === 1) return finalizeMatch(named[0].e, named[0].nm, named[0].conflicts, ref, cands);

  // No name match: descriptive reference or genuinely new. Duplicate exclusion first.
  const strong = scored.filter((x) => x.agreeing >= 2 && x.conflicts.length === 0);
  if (strong.length === 1 && !scored.some((x) => x !== strong[0] && x.agreeing >= 2)) {
    return { classification: "EXISTING_ENTITY", entityId: strong[0].e.id, candidates: cands, severity: "OK", conflicts: [], reason: `resolved by evidence: ${strong[0].reasons.join(", ")}` };
  }
  if (strong.length > 1) return { classification: "AMBIGUOUS", entityId: null, candidates: cands, severity: sev(ref.material, "BLOCK"), conflicts: [], reason: "multiple entities fit the evidence" };
  const weak = scored.filter((x) => x.s > 0 || partialName(x.e, ref.surface));
  if (weak.length) return { classification: "POSSIBLE_DUPLICATE", entityId: null, candidates: cands, severity: sev(ref.material, "NEEDS_REVIEW"), conflicts: [], reason: "partial evidence only; not enough to link or to create" };
  return { classification: "NEW_ENTITY", entityId: null, candidates: [], severity: "OK", conflicts: [], reason: "no candidate after duplicate exclusion; proposal pending commit" };
}

function finalizeMatch(e: RegistryEntity, nm: "exact" | "alias" | "none", conflicts: Resolution["conflicts"], ref: Reference, cands: Resolution["candidates"]): Resolution {
  if (conflicts.length) {
    if (ref.revealEvidence?.trim()) return { classification: nm === "alias" ? "ALIAS" : "EXISTING_ENTITY", entityId: e.id, candidates: cands, severity: "OK", conflicts, reason: "state change supported by explicit reveal evidence" };
    return { classification: "CONFLICT", entityId: e.id, candidates: cands, severity: ref.material ? "BLOCK" : "WARNING", conflicts, reason: "contradicts point-in-time canon without evidence" };
  }
  return { classification: nm === "alias" ? "ALIAS" : "EXISTING_ENTITY", entityId: e.id, candidates: cands, severity: "OK", conflicts: [], reason: nm === "alias" ? "verified alias" : "name match, no contradictions" };
}

/** Acceptance gate for a batch of resolutions (pre-Pass-4, never replaces it). */
export function gateDecision(rs: readonly Resolution[]): Severity {
  const order: Severity[] = ["OK", "WARNING", "NEEDS_REVIEW", "BLOCK"];
  return rs.reduce<Severity>((m, r) => (order.indexOf(r.severity) > order.indexOf(m) ? r.severity : m), "OK");
}

// ---------- Versioned, reversible commits ----------

export interface Commit {
  entityId: string; attribute: keyof Attributes; value: string; at: StoryPosition;
  source: string; authority: VersionedValue["authority"]; evidence: string; sourceSectionKey: string;
}

/** Append-only: earlier versions stay retrievable. Requires evidence; USER_CANON is never superseded by lower authority. */
export function commitChange(reg: readonly RegistryEntity[], c: Commit): RegistryEntity[] {
  if (!c.evidence.trim() || !c.source.trim()) throw new Error("Commit requires source and evidence");
  return reg.map((e) => {
    if (e.id !== c.entityId) return e;
    const vs = [...(e.history[c.attribute] ?? [])];
    const prior = vs.filter((v) => before(v.effectiveAt, c.at)).sort((a, b) => toPosition(b.effectiveAt) - toPosition(a.effectiveAt))[0];
    if (prior && normText(prior.value) === normText(c.value)) return e; // idempotent
    if (prior?.authority === "USER_CANON" && c.authority !== "USER_CANON") throw new Error("Cannot override user canon");
    vs.push({ value: c.value, effectiveAt: c.at, source: c.source, authority: c.authority, evidence: c.evidence, sourceSectionKey: c.sourceSectionKey });
    return { ...e, history: { ...e.history, [c.attribute]: vs } };
  });
}

/** Regeneration undo: drop state committed by one section; user canon and other sections untouched. */
export function undoSection(reg: readonly RegistryEntity[], sectionKey: string): RegistryEntity[] {
  return reg.map((e) => {
    const h: RegistryEntity["history"] = {};
    for (const [k, vs] of Object.entries(e.history) as [keyof Attributes, VersionedValue[]][]) {
      h[k] = vs.filter((v) => v.sourceSectionKey !== sectionKey || v.authority === "USER_CANON");
    }
    return { ...e, history: h };
  });
}
