// Phase 2D: plan how accepted story memory enters the identity registry. Pure, no I/O.
// Input is state the extraction step already evidence-checked from the ACCEPTED section text.
// Rule: a proposal gets an id only when the resolver says NEW_ENTITY (no candidate after
// duplicate exclusion) or links to exactly one existing entity. Anything uncertain is skipped.
import { resolveReference, type EntityKind, type RegistryEntity } from "./identity.ts";
import { toPosition, type StoryPosition } from "./rules.ts";

export interface Proposal { key: string; name: string; kind: EntityKind; attribute: "role" | "description"; value: string | null; evidence: string; outline: boolean }
export interface SyncPlan {
  create: { key: string; name: string; kind: EntityKind; introducedPosition: number }[];
  changes: { entity_key: string; attribute: string; value: string; authority: string; evidence: string; source: string }[];
  skipped: { name: string; classification: string; reason: string }[];
}

const KIND: Record<string, EntityKind> = { person: "person", character: "person", organization: "organization", company: "organization", place: "place", location: "place", object: "object", item: "object", framework: "framework", claim: "claim", definition: "definition", concept: "definition", artifact: "artifact", api: "artifact", code: "artifact", version: "artifact", recipe: "recipe" };
const RANK: Record<string, number> = { USER_CANON: 4, OUTLINE_CANON: 3, APPROVED_GENERATED_STATE: 2, AI_INFERENCE: 1 };
export const kindFor = (t: string | null | undefined): EntityKind => KIND[String(t ?? "").toLowerCase()] ?? "other";

export function planIdentitySync(registry: readonly RegistryEntity[], proposals: readonly Proposal[], pos: StoryPosition): SyncPlan {
  const plan: SyncPlan = { create: [], changes: [], skipped: [] };
  const sim: RegistryEntity[] = [...registry];
  for (const p of proposals) {
    const res = resolveReference(sim, { surface: p.name, kind: p.kind, material: true }, pos);
    let key: string | null = null;
    if (res.classification === "NEW_ENTITY") {
      key = `new:${p.key}`;
      const introducedPosition = p.outline ? 0 : toPosition(pos);
      plan.create.push({ key, name: p.name, kind: p.kind, introducedPosition });
      sim.push({ id: key, kind: p.kind, name: p.name, aliases: [], introducedAt: { chapterIndex: Math.floor(introducedPosition / 10000), subsectionIndex: introducedPosition % 10000 }, history: {} });
    } else if ((res.classification === "EXISTING_ENTITY" || res.classification === "ALIAS") && res.entityId) {
      key = res.entityId;
    } else {
      plan.skipped.push({ name: p.name, classification: res.classification, reason: res.reason });
      continue;
    }
    const authority = p.outline ? "OUTLINE_CANON" : "AI_INFERENCE";
    const existing = sim.find((e) => e.id === key);
    const prior = existing ? (existing.history[p.attribute] ?? []).filter((v) => toPosition(v.effectiveAt) <= toPosition(pos)).sort((a, b) => toPosition(b.effectiveAt) - toPosition(a.effectiveAt))[0] : undefined;
    if (prior && prior.value.trim().toLowerCase() !== (p.value ?? "").trim().toLowerCase() && RANK[prior.authority] > RANK[authority]) {
      plan.skipped.push({ name: p.name, classification: "LOWER_AUTHORITY", reason: `${p.attribute} is held by ${prior.authority}; not overwritten` });
      continue;
    }
    if (p.value?.trim() && p.evidence.trim()) {
      plan.changes.push({ entity_key: key, attribute: p.attribute, value: p.value.trim(), authority, evidence: p.evidence.slice(0, 500), source: p.outline ? "outline" : "accepted section" });
    }
  }
  return plan;
}
