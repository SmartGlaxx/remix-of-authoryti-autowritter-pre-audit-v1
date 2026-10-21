// Central role → model resolution. Edge functions call resolveModelForRole and nothing else;
// no role conditionals live in individual functions.
import { ALL_ROLES, getModel, type Role } from "./registry.ts";
import { getProfile, isTier, reasoningFor, thinkingFor, slotForRole, type Tier } from "../writers/profiles.ts";

export type ConfigMode = "legacy" | "optimized" | "single" | "custom" | "profile";

export interface BookModelConfig {
  mode: ConfigMode;
  singleModel?: string | null;
  roleModels?: Partial<Record<Role, string>>;
  /** Explicit, user-enabled fallbacks. Absent = stop safely on failure. */
  fallbacks?: Partial<Record<Role, string>>;
  /** mode "profile": fixed Writer × Tier profile (models locked). */
  profileWriter?: string | null;
  profileTier?: Tier | null;
}

/** Default role map for books without a model config. Gemini removed by owner request (no credits) —
 *  background jobs use OpenAI, prose stays on DeepSeek. */
export const LEGACY_ROLE_MODELS: Record<Role, string> = {
  planner: "openai/gpt-6-sol",
  writer: "deepseek/deepseek-reasoner",
  narrative_extractor: "openai/gpt-6-luna",
  continuity_checker: "openai/gpt-6-luna",
  continuity_reviser: "openai/gpt-6-sol",
  editor: "openai/gpt-6-sol",
  difficult_chapter: "deepseek/deepseek-reasoner",
  manuscript_auditor: "openai/gpt-6-astra",
  character_generator: "openai/gpt-6-sol",
  summarizer: "openai/gpt-6-luna",
  intro_writer: "deepseek/deepseek-chat",
  literary_reviser: "openai/gpt-6-sol",
};
/** DeepSeek failures fall back to OpenAI (never Gemini). */
export const LEGACY_FALLBACKS: Partial<Record<Role, string>> = {
  writer: "openai/gpt-6-sol",
  difficult_chapter: "openai/gpt-6-sol",
  intro_writer: "openai/gpt-6-sol",
  literary_reviser: "openai/gpt-6-sol",
};

/** Fast-draft prose: long-thinking models swap to their non-thinking counterparts. */
export const FAST_PROSE_MAP: Record<string, string> = {
  "deepseek/deepseek-reasoner": "deepseek/deepseek-chat",
};
const PROSE_ROLES: ReadonlySet<Role> = new Set(["writer", "difficult_chapter", "intro_writer"]);

/** "Optimized — Recommended" workflow configuration. */
export const OPTIMIZED_ROLE_MODELS: Record<Role, string> = {
  planner: "openai/gpt-6-sol",
  writer: "openai/gpt-6-sol",
  narrative_extractor: "openai/gpt-6-luna",
  continuity_checker: "openai/gpt-6-luna",
  continuity_reviser: "openai/gpt-6-sol",
  editor: "openai/gpt-6-sol",
  difficult_chapter: "openai/gpt-6-astra",
  manuscript_auditor: "openai/gpt-6-astra",
  character_generator: "openai/gpt-6-sol",
  summarizer: "openai/gpt-6-luna",
  intro_writer: "openai/gpt-6-sol",
  literary_reviser: "openai/gpt-6-sol",
};
export const OPTIMIZED_LABEL = "Optimized — Recommended";

export const DEFAULT_CONFIG: BookModelConfig = { mode: "legacy" };

/** Old browser model picker values → registry keys (kept for backward compatibility). */
export const LEGACY_PICKER_MAP: Record<string, string> = {
  "deepseek-reasoner": "deepseek/deepseek-reasoner",
  "gpt-6-astra": "openai/gpt-6-astra",
  "gemini-3.1-pro": "google/gemini-3.1-pro-preview",
  "gemini-3.8-flash": "google/gemini-3.8-flash",
};

export interface ResolvedModel {
  role: Role;
  model: string;
  fallback: string | null;
  source: ConfigMode;
  reasoning?: "low" | "medium" | "high";
  thinking?: boolean | "deep";
}

function validKey(k: unknown): k is string {
  return typeof k === "string" && !!getModel(k);
}

export function normalizeConfig(raw: unknown): BookModelConfig {
  if (!raw || typeof raw !== "object") return DEFAULT_CONFIG;
  const r = raw as Record<string, unknown>;
  const mode = (["legacy", "optimized", "single", "custom", "profile"] as const).includes(r.mode as ConfigMode) ? (r.mode as ConfigMode) : "legacy";
  const pick = (o: unknown) => {
    const out: Partial<Record<Role, string>> = {};
    if (o && typeof o === "object") for (const role of ALL_ROLES) { const v = (o as Record<string, unknown>)[role]; if (validKey(v)) out[role] = v; }
    return out;
  };
  const single = r.singleModel ?? r.single_model;
  const pw = r.profileWriter ?? r.profile_writer, pt = r.profileTier ?? r.profile_tier;
  const profileWriter = typeof pw === "string" ? pw : null, profileTier = isTier(pt) ? pt : null;
  const finalMode = mode === "profile" && !getProfile(profileWriter, profileTier) ? "legacy" : mode;
  return { mode: finalMode, profileWriter, profileTier, singleModel: validKey(single) ? single : null, roleModels: pick(r.roleModels ?? r.role_models), fallbacks: pick(r.fallbacks) };
}

/** Script formats (dialogue mechanics, sluglines) draft on Sol; every prose book drafts on the profile's draft model. */
export const SCRIPT_BOOK_TYPES: ReadonlySet<string> = new Set(["drama"]);
export const SCRIPT_DRAFT_MODEL = "openai/gpt-6-sol";

export function resolveModelForRole(config: BookModelConfig | null | undefined, role: Role, opts: { fast?: boolean; bookType?: string | null } = {}): ResolvedModel {
  const c = normalizeConfig(config ?? DEFAULT_CONFIG);
  const explicitFallback = c.fallbacks?.[role] ?? null;
  let resolved = resolve(c, role, explicitFallback);
  // Locked premier pipeline: drafting model follows the book type automatically (no author control).
  if (c.mode === "profile" && PROSE_ROLES.has(role) && opts.bookType && SCRIPT_BOOK_TYPES.has(opts.bookType)) {
    resolved = { ...resolved, model: SCRIPT_DRAFT_MODEL, reasoning: undefined, thinking: undefined };
  }
  if (!opts.fast || !PROSE_ROLES.has(role)) return resolved;
  const quicker = FAST_PROSE_MAP[resolved.model];
  if (!quicker) return resolved;
  return { ...resolved, model: quicker, reasoning: undefined, thinking: undefined };
}

function resolve(c: BookModelConfig, role: Role, explicitFallback: string | null): ResolvedModel {
  switch (c.mode) {
    case "profile": {
      const prof = getProfile(c.profileWriter, c.profileTier)!;
      const slot = slotForRole(prof, role);
      // Locked: per-role overrides are ignored; no silent fallback to another model.
      return { role, model: slot.model, fallback: null, source: "profile", reasoning: reasoningFor(slot.mode), thinking: thinkingFor(slot.mode) };
    }
    case "optimized":
      return { role, model: c.roleModels?.[role] ?? OPTIMIZED_ROLE_MODELS[role], fallback: explicitFallback, source: "optimized" };
    case "single":
      return { role, model: c.singleModel ?? LEGACY_ROLE_MODELS[role], fallback: explicitFallback, source: "single" };
    case "custom":
      return { role, model: c.roleModels?.[role] ?? LEGACY_ROLE_MODELS[role], fallback: explicitFallback, source: "custom" };
    default:
      return { role, model: c.roleModels?.[role] ?? LEGACY_ROLE_MODELS[role], fallback: explicitFallback ?? LEGACY_FALLBACKS[role] ?? null, source: "legacy" };
  }
}

export function resolveAllRoles(config: BookModelConfig | null | undefined): Record<Role, ResolvedModel> {
  return Object.fromEntries(ALL_ROLES.map((r) => [r, resolveModelForRole(config, r)])) as Record<Role, ResolvedModel>;
}
