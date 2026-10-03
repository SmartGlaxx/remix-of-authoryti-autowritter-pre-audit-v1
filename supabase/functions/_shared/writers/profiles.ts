// 48 fixed Writer × Tier execution profiles (pure data). Users pick writer + tier only;
// the four role models inside a profile are locked. Model keys must exist in the AI registry
// (validated by tests): Sonnet 5.5 → anthropic/claude-sonnet-5, Haiku → anthropic/claude-haiku-4-5,
// Gemini 3.1 Pro → google/gemini-3.1-pro-preview (the IDs the providers actually serve).
import type { Role } from "../ai/registry.ts";

export type Tier = "economy" | "balanced" | "professional" | "maximum";
export const TIERS: { value: Tier; label: string }[] = [
  { value: "economy", label: "Economy" }, { value: "balanced", label: "Balanced" },
  { value: "professional", label: "Professional" }, { value: "maximum", label: "Maximum" },
];
export type ProfileRole = "draft" | "revision" | "continuity" | "auditor";
export const PROFILE_ROLE_LABELS: Record<ProfileRole, string> = { draft: "Draft", revision: "Revision", continuity: "Continuity", auditor: "Audit" };
/** Mode is informational unless the adapter supports it (OpenAI reasoning effort today). */
export type Mode = "thinking" | "non-thinking" | "low" | "medium" | "high" | "adaptive" | "extended" | null;
export interface Slot { model: string; mode: Mode }
export type Profile = Record<ProfileRole, Slot>;

/** Pipeline roles each profile role drives. */
export const ROLE_MAP: Record<Role, ProfileRole> = {
  writer: "draft", difficult_chapter: "draft", intro_writer: "draft",
  editor: "revision", continuity_reviser: "revision",
  continuity_checker: "continuity", narrative_extractor: "continuity", summarizer: "continuity",
  manuscript_auditor: "auditor", planner: "auditor", character_generator: "auditor",
};

const DSF = "deepseek/deepseek-flash", DSP = "deepseek/deepseek-v4-pro", GF = "google/gemini-3.8-flash", GP = "google/gemini-3.1-pro-preview";
const HA = "anthropic/claude-haiku-4-5", SO = "anthropic/claude-sonnet-5", OP = "anthropic/claude-opus-5-5", FA = "anthropic/claude-fable-5-1";
const LU = "openai/gpt-6-luna", SOL = "openai/gpt-6-sol", AS = "openai/gpt-6-astra";
const s = (model: string, mode: Mode = null): Slot => ({ model, mode });
const p = (d: Slot, r: Slot, c: Slot, a: Slot): Profile => ({ draft: d, revision: r, continuity: c, auditor: a });

export const PROFILES: Record<string, Record<Tier, Profile>> = {
  elena: {
    economy: p(s(DSF, "thinking"), s(GF, "non-thinking"), s(LU), s(LU)),
    balanced: p(s(DSF, "thinking"), s(SO), s(LU), s(GP)),
    professional: p(s(SO), s(OP), s(LU), s(SOL)),
    maximum: p(s(OP), s(FA), s(SOL), s(AS)),
  },
  maya: {
    economy: p(s(DSF, "non-thinking"), s(DSF, "non-thinking"), s(LU), s(LU)),
    balanced: p(s(DSF, "thinking"), s(SOL), s(LU), s(SOL)),
    professional: p(s(SOL), s(SO), s(LU), s(SOL)),
    maximum: p(s(AS), s(SOL), s(SOL), s(FA)),
  },
  claire: {
    economy: p(s(GF, "thinking"), s(GF, "non-thinking"), s(LU), s(LU)),
    balanced: p(s(GP), s(SOL), s(LU), s(GP)),
    professional: p(s(SOL), s(GP), s(LU), s(AS)),
    maximum: p(s(AS), s(GP), s(SOL), s(AS)),
  },
  nora: {
    economy: p(s(HA), s(GF), s(LU), s(LU)),
    balanced: p(s(HA, "extended"), s(SO), s(LU), s(LU)),
    professional: p(s(SO), s(SO), s(LU), s(SOL)),
    maximum: p(s(OP), s(OP), s(SOL), s(SOL)),
  },
  sophia: {
    economy: p(s(DSP, "thinking"), s(HA), s(LU), s(LU)),
    balanced: p(s(SO), s(SO), s(LU), s(SOL)),
    professional: p(s(OP), s(FA), s(SOL), s(AS)),
    maximum: p(s(OP, "adaptive"), s(FA), s(SOL), s(AS)),
  },
  priya: {
    economy: p(s(DSF, "thinking"), s(GF), s(LU), s(LU)),
    balanced: p(s(GF, "medium"), s(SO), s(LU), s(GP)),
    professional: p(s(GP), s(SOL), s(LU), s(FA)),
    maximum: p(s(GP), s(FA), s(SOL), s(AS)),
  },
  daniel: {
    economy: p(s(DSF, "non-thinking"), s(DSF), s(LU), s(LU)),
    balanced: p(s(DSF, "thinking"), s(SOL), s(LU), s(SOL)),
    professional: p(s(SOL), s(SOL), s(LU), s(SOL)),
    maximum: p(s(SOL, "high"), s(AS), s(SOL), s(AS)),
  },
  marcus: {
    economy: p(s(DSF, "thinking"), s(DSF), s(LU), s(LU)),
    balanced: p(s(DSP), s(SO), s(LU), s(SOL)),
    professional: p(s(SO), s(SOL), s(LU), s(SOL)),
    maximum: p(s(AS), s(OP), s(SOL), s(FA)),
  },
  adrian: {
    economy: p(s(DSP, "thinking"), s(GF), s(LU), s(LU)),
    balanced: p(s(GP), s(SOL), s(LU), s(GP)),
    professional: p(s(SOL, "high"), s(SO), s(LU), s(FA)),
    maximum: p(s(FA), s(AS), s(SOL), s(AS)),
  },
  ethan: {
    economy: p(s(DSF, "non-thinking"), s(HA), s(LU), s(LU)),
    balanced: p(s(HA, "extended"), s(SO), s(LU), s(LU)),
    professional: p(s(SO), s(SO), s(LU), s(SOL)),
    maximum: p(s(OP), s(SOL), s(SOL), s(AS)),
  },
  julian: {
    economy: p(s(DSP, "thinking"), s(DSF), s(LU), s(LU)),
    balanced: p(s(DSP), s(SO), s(LU), s(SOL)),
    professional: p(s(SO), s(OP), s(SOL), s(SOL)),
    maximum: p(s(OP, "adaptive"), s(FA), s(SOL), s(AS)),
  },
  luca: {
    economy: p(s(DSF, "non-thinking"), s(GF), s(LU), s(LU)),
    balanced: p(s(GF, "low"), s(SO), s(LU), s(GP)),
    professional: p(s(SO), s(OP), s(LU), s(SOL)),
    maximum: p(s(OP), s(OP), s(SOL), s(FA)),
  },
};

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

/** Thinking on/off for providers with a thinking switch (DeepSeek V4). undefined = provider default. */
export function thinkingFor(mode: Mode): boolean | undefined {
  if (mode === "thinking" || mode === "extended" || mode === "adaptive") return true;
  if (mode === "non-thinking") return false;
  return undefined;
}
