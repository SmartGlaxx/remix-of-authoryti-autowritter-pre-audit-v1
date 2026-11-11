// 48 fixed Writer × Tier execution profiles (pure data). Users pick writer + tier only;
// the four role models inside a profile are locked. Model keys must exist in the AI registry
// (validated by tests): Sonnet 5.5 → anthropic/claude-sonnet-5, Haiku → anthropic/claude-haiku-4-5,
// Gemini 3.1 Pro → google/gemini-3.1-pro-preview (the IDs the providers actually serve).
import type { Role } from "../ai/registry.ts";

export type Tier = "economy" | "balanced" | "professional" | "maximum";
export const DEFAULT_WRITER_TIER: Tier = "professional";
/** Missing selections get the starting tier; explicit saved tiers are retained. */
export function writerTierOrDefault(tier: Tier | null | undefined): Tier { return tier ?? DEFAULT_WRITER_TIER; }
export const TIERS: { value: Tier; label: string }[] = [{ value: "professional", label: "Premier" }];
export type ProfileRole = "draft" | "revision" | "continuity" | "auditor";
export const PROFILE_ROLE_LABELS: Record<ProfileRole, string> = { draft: "Draft", revision: "Revision", continuity: "Continuity", auditor: "Audit" };
/** Mode = thinking/effort; applied by the adapters (OpenAI/Gemini effort, DeepSeek/Gemini/Claude thinking). */
export type Mode = "thinking" | "non-thinking" | "low" | "medium" | "high" | "adaptive" | "extended" | null;
export interface Slot { model: string; mode: Mode }
export type Profile = Record<ProfileRole, Slot>;

/** Pipeline roles each profile role drives. */
export const ROLE_MAP: Record<Role, ProfileRole> = {
  writer: "draft", difficult_chapter: "draft", intro_writer: "draft",
  editor: "revision", continuity_reviser: "revision", literary_reviser: "revision",
  continuity_checker: "continuity", narrative_extractor: "continuity", summarizer: "continuity",
  manuscript_auditor: "auditor", planner: "auditor", character_generator: "auditor",
};

const SO = "anthropic/claude-sonnet-5";
const SOL = "openai/gpt-6-sol";
const s = (model: string, mode: Mode = null): Slot => ({ model, mode });
const p = (d: Slot, r: Slot, c: Slot, a: Slot): Profile => ({ draft: d, revision: r, continuity: c, auditor: a });

/** One pipeline for every writer (one tier). Draft: Sonnet 5 (writer toggle → Sol) · everything else: Sol.
 * Writers differ only in persona, sliders and tone. No other models. */
export const PREMIER_PROFILE: Profile = p(s(SO), s(SOL), s(SOL, "low"), s(SOL, "low"));
const WRITER_IDS = ["elena", "maya", "claire", "nora", "sophia", "priya", "daniel", "marcus", "adrian", "ethan", "julian", "luca", "vivian", "rafe", "simon", "harriet", "edmund", "margaret", "henri", "lena", "rose", "nikolai", "jack", "thomas", "amara", "charlotte", "bella", "niamh", "orson", "zane", "rohan", "dash", "lev", "kenji", "kofi", "samir", "hiro", "meilin", "imogen", "georgia"];
/** Legacy saved tiers still resolve — every tier maps to the premier profile. */
export const PROFILES: Record<string, Record<Tier, Profile>> = Object.fromEntries(
  WRITER_IDS.map((id) => [id, { economy: PREMIER_PROFILE, balanced: PREMIER_PROFILE, professional: PREMIER_PROFILE, maximum: PREMIER_PROFILE }]),
);

export function isTier(t: unknown): t is Tier { return t === "economy" || t === "balanced" || t === "professional" || t === "maximum"; }

export function getProfile(writerId: string | null | undefined, tier: Tier | null | undefined): Profile | null {
  if (!writerId || !tier) return null;
  return PROFILES[writerId]?.[tier] ?? null;
}

export function slotForRole(profile: Profile, role: Role): Slot { return profile[ROLE_MAP[role]]; }

/** Reasoning effort the adapters understand, or undefined. */
export function reasoningFor(mode: Mode): "low" | "medium" | "high" | undefined {
  return mode === "low" || mode === "medium" || mode === "high" ? mode : undefined;
}

/** Thinking switch applied by every adapter (DeepSeek, Gemini, Claude). undefined = provider default. */
export function thinkingFor(mode: Mode): boolean | "deep" | undefined {
  if (mode === "adaptive") return "deep";
  if (mode === "thinking" || mode === "extended") return true;
  if (mode === "non-thinking") return false;
  return undefined;
}
