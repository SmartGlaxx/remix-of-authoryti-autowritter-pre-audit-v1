// Central model registry — the ONLY place model metadata and pricing live.
// Pure data + lookups: imported by edge functions, the browser and tests.
// `null` means "unknown" — never guess a capability or a price.

export type ProviderId = "openai" | "anthropic" | "deepseek" | "gemini";

/** Every role the pipeline knows about. Only ACTIVE_ROLES execute in Pass 3. */
export type Role =
  | "planner"
  | "writer"
  | "narrative_extractor"
  | "continuity_checker"
  | "continuity_reviser"
  | "editor"
  | "difficult_chapter"
  | "manuscript_auditor"
  // auxiliary roles used by existing features
  | "character_generator"
  | "summarizer"
  | "intro_writer"
  // optional literary editing (separate from manual paragraph "editor" and continuity repair)
  | "literary_reviser";

export const USER_ROLES: Role[] = ["planner", "writer", "narrative_extractor", "continuity_checker", "continuity_reviser", "editor", "difficult_chapter", "manuscript_auditor"];
export const AUX_ROLES: Role[] = ["character_generator", "summarizer", "intro_writer", "literary_reviser"];
export const ALL_ROLES: Role[] = [...USER_ROLES, ...AUX_ROLES];
/** Roles with a real pipeline behind them today. Others are stored but never invoked. */
export const ACTIVE_ROLES: Role[] = ["planner", "writer", "narrative_extractor", "continuity_checker", "continuity_reviser", "editor", "manuscript_auditor", "character_generator", "summarizer", "intro_writer", "literary_reviser"];

export const ROLE_LABELS: Record<Role, string> = {
  planner: "Planner (outlines)",
  writer: "Writer (prose)",
  narrative_extractor: "Story-memory extractor",
  continuity_checker: "Continuity checker",
  continuity_reviser: "Continuity reviser",
  editor: "Editor (rewrites)",
  difficult_chapter: "Difficult chapters",
  manuscript_auditor: "Manuscript auditor",
  character_generator: "Character profiles",
  summarizer: "Summaries",
  intro_writer: "Introductions",
  literary_reviser: "Literary reviser",
};

export interface Pricing {
  /** USD per 1M tokens. */
  inputPerM: number | null;
  cachedInputPerM: number | null;
  outputPerM: number | null;
  source: string;
}

export interface ModelInfo {
  /** Stable key stored in configs, e.g. "openai/gpt-6-sol". */
  key: string;
  provider: ProviderId;
  /** Id sent to the provider's own API when a user key is used. */
  directId: string;
  /** Id sent through the built-in gateway (null = not available there). */
  gatewayId: string | null;
  displayName: string;
  roles: Role[] | "all";
  contextTokens: number | null;
  maxOutputTokens: number | null;
  structuredOutput: boolean | null;
  reasoningControls: boolean | null;
  /** Rejects temperature/top_p. */
  rejectsSampling?: boolean;
  pricing: Pricing;
  /** Kept for existing books; not offered for new selection. */
  legacyOnly?: boolean;
}

const GW = "Lovable AI gateway catalog, 2026-09";

export const MODEL_REGISTRY: ModelInfo[] = [
  { key: "openai/gpt-6-sol", provider: "openai", directId: "gpt-6-sol", gatewayId: "openai/gpt-6-sol", displayName: "GPT-6 Sol", roles: "all", contextTokens: null, maxOutputTokens: null, structuredOutput: true, reasoningControls: true, rejectsSampling: true, pricing: { inputPerM: 2, cachedInputPerM: 0.2, outputPerM: 10, source: GW } },
  { key: "anthropic/claude-sonnet-5", provider: "anthropic", directId: "claude-sonnet-5", gatewayId: "anthropic/claude-sonnet-5", displayName: "Claude Sonnet 5", roles: "all", contextTokens: 1000000, maxOutputTokens: 128000, structuredOutput: null, reasoningControls: null, pricing: { inputPerM: 2, cachedInputPerM: 0.2, outputPerM: 10, source: GW } },
];

export const PROVIDER_LABELS: Record<ProviderId, string> = { openai: "OpenAI", anthropic: "Anthropic", deepseek: "DeepSeek", gemini: "Google Gemini" };

export function getModel(key: string): ModelInfo | undefined {
  return MODEL_REGISTRY.find((m) => m.key === key);
}

export function requireModel(key: string): ModelInfo {
  const m = getModel(key);
  if (!m) throw new Error(`Unknown model "${key}"`);
  return m;
}

export function modelLabel(key: string): string {
  const m = getModel(key);
  return m ? `${PROVIDER_LABELS[m.provider]} · ${m.displayName}` : key;
}

export function modelSupportsRole(m: ModelInfo, role: Role): boolean {
  return m.roles === "all" || m.roles.includes(role);
}

/** Estimated cost in USD, or null if pricing or token counts are unknown. Never fabricates. */
export function estimateCostUSD(
  modelKey: string,
  usage: { inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null },
): number | null {
  const m = getModel(modelKey);
  if (!m) return null;
  const p = m.pricing;
  if (usage.inputTokens == null || usage.outputTokens == null) return null;
  if (p.inputPerM == null || p.outputPerM == null) return null;
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const cachedRate = p.cachedInputPerM ?? p.inputPerM;
  const cost = ((usage.inputTokens - cached) * p.inputPerM + cached * cachedRate + usage.outputTokens * p.outputPerM) / 1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}
