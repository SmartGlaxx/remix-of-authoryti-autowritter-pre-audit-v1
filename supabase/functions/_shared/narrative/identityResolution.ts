// Phase 2 — authoritative identity resolution for Persona Studio (pure; used by the
// persona-studio server function and mirrored in the browser for early feedback only).
// Never merges: any possible match returns a status that requires an explicit author decision.
import { distinctFullNames } from "./identity.ts";

export interface KnownIdentity {
  id: string;
  displayName: string;
  aliases: string[];
  universeId: string | null;
}

export interface ProposedIdentity {
  displayName: string;
  aliases?: string[];
  universeId: string | null;
}

export type ResolutionStatus = "NEW" | "EXACT_MATCH" | "AMBIGUOUS";
export type MatchReason = "same_name" | "alias_match" | "shared_name_token" | "name_contained";
export interface IdentityMatch { id: string; displayName: string; reason: MatchReason }
export interface IdentityResolution { status: ResolutionStatus; matches: IdentityMatch[] }

/** Author decision required whenever status is not NEW. */
export type ResolutionDecision = "create_distinct" | "use_existing";

const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "sir", "lady", "lord", "the", "of", "jr", "sr"]);

export function normName(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s'-]/g, " ").replace(/\s+/g, " ").trim();
}

export function nameTokensClean(s: string): string[] {
  return normName(s).split(" ").filter((t) => t.length > 0 && !HONORIFICS.has(t.replace(/\.$/, "")));
}

function compareNames(a: string, b: string): MatchReason | null {
  const ta = nameTokensClean(a), tb = nameTokensClean(b);
  if (!ta.length || !tb.length) return null;
  if (ta.join(" ") === tb.join(" ")) return "same_name";
  // Different surnames on two full names = different people (Phase 2D invariant).
  if (distinctFullNames(ta.join(" "), tb.join(" "))) return null;
  const sa = new Set(ta), sb = new Set(tb);
  if (ta.every((t) => sb.has(t)) || tb.every((t) => sa.has(t))) return "name_contained";
  if (ta.some((t) => t.length > 2 && sb.has(t))) return "shared_name_token";
  return null;
}

/** Resolve a proposed identity against the owner's identities in the same universe only. */
export function resolveIdentity(existing: readonly KnownIdentity[], proposal: ProposedIdentity): IdentityResolution {
  const names = [proposal.displayName, ...(proposal.aliases ?? [])].filter((n) => n && n.trim());
  const matches: IdentityMatch[] = [];
  let exact = false;
  for (const e of existing) {
    if ((e.universeId ?? null) !== (proposal.universeId ?? null)) continue;
    let best: MatchReason | null = null;
    for (const n of names) {
      for (const [m, isAlias] of [[e.displayName, false], ...e.aliases.map((a) => [a, true] as const)] as const) {
        const r = compareNames(n, m);
        if (!r) continue;
        const reason: MatchReason = r === "same_name" && isAlias ? "alias_match" : r;
        if (reason === "same_name" || reason === "alias_match") exact = true;
        if (!best || rank(reason) < rank(best)) best = reason;
      }
    }
    if (best) matches.push({ id: e.id, displayName: e.displayName, reason: best });
  }
  matches.sort((a, b) => rank(a.reason) - rank(b.reason));
  return { status: matches.length === 0 ? "NEW" : exact ? "EXACT_MATCH" : "AMBIGUOUS", matches };
}

function rank(r: MatchReason): number {
  return { same_name: 0, alias_match: 1, name_contained: 2, shared_name_token: 3 }[r];
}

/**
 * Gate: creation proceeds only for NEW, or with an explicit decision.
 * "use_existing" must name one of the matched ids — the server never picks one itself.
 */
export function gateCreation(
  res: IdentityResolution,
  decision?: ResolutionDecision,
  existingId?: string,
): { action: "create" } | { action: "use_existing"; id: string } | { action: "confirm"; resolution: IdentityResolution } {
  if (res.status === "NEW") return { action: "create" };
  if (decision === "create_distinct") return { action: "create" };
  if (decision === "use_existing" && existingId && res.matches.some((m) => m.id === existingId)) {
    return { action: "use_existing", id: existingId };
  }
  return { action: "confirm", resolution: res };
}
