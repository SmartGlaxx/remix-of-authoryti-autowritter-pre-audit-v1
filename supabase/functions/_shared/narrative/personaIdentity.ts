// Pure contracts for stable narrative identities (Persona Studio Phase 1).
// Pen names, fictional personas and AI writer profiles are separate entity kinds;
// promotion attaches a persona profile to an existing identity id and never rewrites links.

export type EntityKind = "pen_name" | "narrative_identity" | "writer_profile";

export type IdentityLevel = "seed" | "mentioned" | "story_character" | "major_character" | "independent_persona";

export const LEVEL_ORDER: IdentityLevel[] = ["seed", "mentioned", "story_character", "major_character", "independent_persona"];

export interface NarrativeIdentity {
  id: string;
  userId: string;
  universeId: string | null;
  displayName: string;
  aliases: string[];
  level: IdentityLevel;
}

export interface Relationship {
  id: string;
  subjectIdentityId: string;
  targetIdentityId: string;
  universeId: string | null;
  type: string;
}

/** A pen name may never be used where a fictional identity is required, and vice versa. */
export function assertEntityKind(actual: EntityKind, expected: EntityKind): void {
  if (actual !== expected) throw new Error(`ENTITY_KIND_MISMATCH:${actual}->${expected}`);
}

/** Promotion only moves upward and keeps the identity id; relationships are untouched. */
export function promoteIdentity(identity: NarrativeIdentity, to: IdentityLevel): NarrativeIdentity {
  if (LEVEL_ORDER.indexOf(to) < LEVEL_ORDER.indexOf(identity.level)) {
    throw new Error("PROMOTION_MUST_NOT_DEMOTE");
  }
  return { ...identity, level: to };
}

/** Mirror of the DB universe-isolation trigger. */
export function relationshipAllowed(
  subject: NarrativeIdentity,
  target: NarrativeIdentity,
  universeId: string | null,
): { ok: true } | { ok: false; reason: string } {
  if (subject.id === target.id) return { ok: false, reason: "SELF_RELATIONSHIP" };
  if (subject.userId !== target.userId) return { ok: false, reason: "OWNER_MISMATCH" };
  if (subject.universeId !== target.universeId || subject.universeId !== universeId) {
    return { ok: false, reason: "RELATIONSHIP_UNIVERSE_MISMATCH" };
  }
  return { ok: true };
}

/** Relationships touching an identity, resolved by stable id (works for any level). */
export function relationshipsFor(identityId: string, all: Relationship[]): Relationship[] {
  return all.filter((r) => r.subjectIdentityId === identityId || r.targetIdentityId === identityId);
}
