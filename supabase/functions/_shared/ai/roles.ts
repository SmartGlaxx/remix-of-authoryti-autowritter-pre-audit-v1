// Central role → model resolution. Edge functions call resolveModelForRole and nothing else;
// no role conditionals live in individual functions.
import { ALL_ROLES, getModel, type Role } from "./registry.ts";
import { DEFAULT_WRITER_TIER, PREMIER_PROFILE, isTier, reasoningFor, thinkingFor, slotForRole, type Tier } from "../writers/profiles.ts";

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
  /** Writer toggle: draft prose on Sonnet 5 (default) or Sol. Missing = Sonnet, except script formats = Sol. */
  draftModel?: DraftChoice | null;
}

/** One pipeline for every book: Sonnet 5 drafts prose, Sol does everything else. Kept names for callers. */
const SONNET = "anthropic/claude-sonnet-5", SOL = "openai/gpt-6-sol";
export const DRAFT_MODELS = { sonnet: SONNET, sol: SOL } as const;
export type DraftChoice = keyof typeof DRAFT_MODELS;
export const LEGACY_ROLE_MODELS: Record<Role, string> = {
  planner: SOL, writer: SONNET, narrative_extractor: SOL, continuity_checker: SOL, continuity_reviser: SOL, editor: SOL,
  difficult_chapter: SONNET, manuscript_auditor: SOL, character_generator: SOL, summarizer: SOL, intro_writer: SONNET, literary_reviser: SOL,
};
export const LEGACY_FALLBACKS: Partial<Record<Role, string>> = {};
export const FAST_PROSE_MAP: Record<string, string> = {};
const PROSE_ROLES: ReadonlySet<Role> = new Set(["writer", "difficult_chapter", "intro_writer"]);
export const OPTIMIZED_ROLE_MODELS = LEGACY_ROLE_MODELS;
export const OPTIMIZED_LABEL = "Sonnet 5 + Sol";
export const DEFAULT_CONFIG: BookModelConfig = { mode: "profile" };
export const LEGACY_PICKER_MAP: Record<string, string> = {};

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
  const dm = r.draftModel ?? r.draft_model;
  // Every book runs the same pipeline; older saved modes resolve to it too.
  void mode;
  return { mode: "profile", profileWriter, profileTier, draftModel: dm === "sol" || dm === "sonnet" ? dm : null, singleModel: validKey(single) ? single : null, roleModels: pick(r.roleModels ?? r.role_models), fallbacks: pick(r.fallbacks) };
}

/** A book with no saved model config writes through its writer's premium profile (never the legacy DeepSeek map). */
export function defaultBookConfig(writerId: string | null | undefined, draftModel?: DraftChoice | null): BookModelConfig {
  return normalizeConfig({ mode: "profile", profileWriter: writerId ?? null, profileTier: DEFAULT_WRITER_TIER, draftModel: draftModel ?? null });
}

/** Script formats (dialogue mechanics, sluglines) default to Sol; the writer toggle overrides either way. */
export const SCRIPT_BOOK_TYPES: ReadonlySet<string> = new Set(["drama"]);
export const SCRIPT_DRAFT_MODEL = SOL;

/** Story book types whose planning runs on Sonnet 5. */
export const FICTION_PLANNING_TYPES: ReadonlySet<string> = new Set(["novel", "fiction-serial", "short-story", "comic", "drama", "children"]);

export function draftModelFor(choice: DraftChoice | null | undefined, bookType?: string | null): string {
  if (choice) return DRAFT_MODELS[choice];
  return bookType && SCRIPT_BOOK_TYPES.has(bookType) ? SOL : SONNET;
}

export function resolveModelForRole(config: BookModelConfig | null | undefined, role: Role, opts: { fast?: boolean; bookType?: string | null } = {}): ResolvedModel {
  const c = normalizeConfig(config ?? DEFAULT_CONFIG);
  if (PROSE_ROLES.has(role)) return { role, model: draftModelFor(c.draftModel, opts.bookType), fallback: null, source: "profile" };
  // Fiction planning runs on Sonnet 5: Sol's safety filter refuses crime/violence story plans.
  if (role === "planner" && opts.bookType && FICTION_PLANNING_TYPES.has(opts.bookType)) return { role, model: SONNET, fallback: null, source: "profile" };
  const slot = slotForRole(PREMIER_PROFILE, role);
  // Locked: no per-role overrides and no silent fallback to another model.
  return { role, model: slot.model, fallback: null, source: "profile", reasoning: reasoningFor(slot.mode), thinking: thinkingFor(slot.mode) };
}

export function resolveAllRoles(config: BookModelConfig | null | undefined): Record<Role, ResolvedModel> {
  return Object.fromEntries(ALL_ROLES.map((r) => [r, resolveModelForRole(config, r)])) as Record<Role, ResolvedModel>;
}
