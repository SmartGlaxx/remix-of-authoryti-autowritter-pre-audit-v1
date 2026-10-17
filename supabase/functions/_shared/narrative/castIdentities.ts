// Planned cast → knowledge identities. Pure, no I/O.
// Rule: every book cast member counts as a known person for knowledge tracking, so a planned
// character is never sent to "Characters to confirm". Variants like "Kiera Vance (recorded voice)"
// share the base person's identity. Generic unnamed roles stay out (they are not people to track).
import type { KnownIdentity } from "./identityResolution.ts";

export interface CastRow { id: string; name: string; aliases?: string[] | null; narrative_identity_id?: string | null }
export interface CastIdentityPlan {
  /** New identities to create, keyed by normalized base name. */
  create: { key: string; displayName: string; aliases: string[] }[];
  /** Cast row → existing identity id or a `new:` key from `create`. */
  links: { castId: string; target: string }[];
}

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
/** "Kiera Vance (recorded voice)" → "Kiera Vance". */
export const baseName = (n: string) => n.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();

export function planCastIdentities(cast: readonly CastRow[], existing: readonly KnownIdentity[]): CastIdentityPlan {
  const plan: CastIdentityPlan = { create: [], links: [] };
  const index = new Map<string, string>();
  for (const e of existing) for (const n of [e.displayName, ...(e.aliases ?? [])]) if (n) index.set(norm(n), e.id);
  for (const c of cast) {
    if (c.narrative_identity_id) { for (const n of [c.name, baseName(c.name)]) index.set(norm(n), c.narrative_identity_id); }
  }
  for (const c of cast) {
    if (c.narrative_identity_id) continue;
    const base = baseName(c.name);
    if (!base) continue;
    const names = [c.name, base, ...(c.aliases ?? [])].filter(Boolean);
    let target = names.map((n) => index.get(norm(n))).find(Boolean);
    if (!target) {
      const key = `new:${norm(base)}`;
      plan.create.push({ key, displayName: base, aliases: [] });
      target = key;
    }
    const created = plan.create.find((x) => x.key === target);
    if (created) for (const n of names) if (norm(n) !== norm(created.displayName) && !created.aliases.some((a) => norm(a) === norm(n))) created.aliases.push(n);
    for (const n of names) index.set(norm(n), target);
    plan.links.push({ castId: c.id, target });
  }
  return plan;
}
