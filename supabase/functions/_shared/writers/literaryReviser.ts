// Tier 2 Literary Reviser (pure). Separate from the manual paragraph `editor` role and from the
// Tier 1 `continuity_reviser` (mechanical/continuity repair), which are untouched.
// - Mode is per book: "off" (default) | "on_request" (author asks on a held draft) | "automatic".
// - Model is the author's choice (Sol / Astra / Fable) or, if unset, the book's existing resolution
//   for `literary_reviser` (profile revision slot, else Sol). Locked profiles are never modified.
// - Never substitutes a model: a fallback exists only if the author set it AND authorized it.
// - Only the author's own provider key is used (no platform route), and every call reserves its
//   worst-case cost against a per-section ceiling BEFORE sending.
// - Dialogue stays verbatim; the result still goes through full validation and fenced acceptance.
import { getModel } from "../ai/registry.ts";
import { resolveModelForRole, type BookModelConfig } from "../ai/roles.ts";
import type { NaturalnessFinding } from "./naturalness.ts";
import type { Prompt } from "./naturalnessRewrite.ts";

export const LITERARY_MODELS = ["openai/gpt-6-sol"] as const;
export type LiteraryModel = typeof LITERARY_MODELS[number];
export type LiteraryMode = "off" | "on_request" | "automatic";
export const DEFAULT_LITERARY_CAP_USD = 0.25;
export const MAX_LITERARY_CAP_USD = 2;
/** Output ceiling per literary call. Includes OpenAI reasoning tokens; 12 short edits need ~1,000
 *  tokens, so 2,500 leaves room without paying for regenerated sections. */
export const LITERARY_MAX_OUTPUT = 2500;

const isLit = (m: unknown): m is LiteraryModel => typeof m === "string" && (LITERARY_MODELS as readonly string[]).includes(m);
const ctl = (controls: unknown) => ((controls && typeof controls === "object" ? (controls as Record<string, unknown>).literaryReviser : null) ?? {}) as Record<string, unknown>;

export function resolveLiteraryMode(controls: unknown): LiteraryMode {
  const m = ctl(controls).mode;
  return m === "on_request" || m === "automatic" ? m : "off";
}

export interface LiteraryPlan { mode: LiteraryMode; model: string; fallback: string | null; capUsd: number; maxAttempts: number }

export function resolveLiteraryReviser(controls: unknown, config: BookModelConfig | null | undefined): LiteraryPlan {
  const c = ctl(controls);
  const model = isLit(c.model) ? c.model : resolveModelForRole(config, "literary_reviser").model;
  // Fallback only when explicitly configured AND authorized by the author; never implicit.
  const fallback = c.fallbackAuthorized === true && isLit(c.fallback) && c.fallback !== model ? c.fallback : null;
  const raw = Number(c.maxCostUsd);
  const capUsd = raw > 0 ? Math.min(raw, MAX_LITERARY_CAP_USD) : DEFAULT_LITERARY_CAP_USD;
  const maxAttempts = c.maxAttempts === 1 ? 1 : 2;
  return { mode: resolveLiteraryMode(controls), model, fallback, capUsd, maxAttempts };
}

/** Exact-model call config: no role map, no implicit fallback. */
export function literaryCallConfig(plan: LiteraryPlan): BookModelConfig {
  return { mode: "single", singleModel: plan.model, fallbacks: plan.fallback ? { literary_reviser: plan.fallback } : {} };
}

export class LiteraryBudgetError extends Error {
  constructor(msg: string) { super(msg); }
}
/** Worst case in USD at uncached rates; unknown price → refuse (never guess). */
export function worstCaseUsd(model: string, inputTokens: number, maxOut: number): number {
  const p = getModel(model)?.pricing;
  if (!p || p.inputPerM == null || p.outputPerM == null) throw new LiteraryBudgetError(`PRICE_UNKNOWN: ${model}`);
  return (inputTokens * p.inputPerM + maxOut * p.outputPerM) / 1e6;
}
export const countTokens = (s: string) => Math.ceil((s ?? "").length / 3);

/** Per-section ceiling. A reservation covers the primary AND an authorized fallback (whichever costs more). */
export class LiteraryBudget {
  spent = 0;
  constructor(readonly cap: number) { if (!(cap > 0)) throw new LiteraryBudgetError("invalid cap"); }
  reserve(plan: LiteraryPlan, inputTokens: number, maxOut = LITERARY_MAX_OUTPUT): number {
    const cands = [plan.model, ...(plan.fallback ? [plan.fallback] : [])];
    const need = Math.max(...cands.map((m) => worstCaseUsd(m, inputTokens, maxOut)));
    if (this.spent + need > this.cap + 1e-12) throw new LiteraryBudgetError(`LITERARY_CAP_EXCEEDED: needs $${need.toFixed(4)}, $${(this.cap - this.spent).toFixed(4)} left`);
    this.spent += need; // settled down to the actual cost afterwards
    return need;
  }
  settle(reserved: number, actual: number) { this.spent += actual - reserved; }
}

export function buildLiteraryPrompt(text: string, findings: NaturalnessFinding[], o: { writerVoice?: string } = {}): Prompt {
  const issues = findings.map((f, i) => `${i + 1}. [${f.category}] ${f.message}`).join("\n");
  return {
    system: [
      "You are a literary editor. Read the WHOLE section first, then make a small number of targeted structural edits to the narration.",
      "Allowed: delete filler beats, merge or split sentences, reorder clauses, let a concrete action or observation carry a moment, vary where sentences enter, tighten paragraph flow and pacing.",
      "Fix repetition structurally; swapping one repeated sentence shape for another is a failure and will be rejected. Delete stock phrases and repeated identical sentences rather than rephrasing them.",
      "DIALOGUE IS FROZEN: never change anything inside quotation marks, and do not alter spoken words. Do not claim or attempt dialogue or subtext edits.",
      "Keep plot, events, facts, names, numbers, dates, character knowledge, chronology and point of view exactly as they are. Add no new facts, characters or events.",
      "Keep deliberate parallelism and motifs. Do not force metaphors. Preserve the writer's voice. Change at most about a fifth of the text.",
      o.writerVoice ? `Writer voice to preserve: ${o.writerVoice.slice(0, 600)}` : "",
      'OUTPUT FORMAT (strict): return ONLY one JSON object, {"edits":[{"find":"...","replace":"..."}]}, nothing before or after it: no explanation, no commentary, no reasoning, no markdown fences, and never the rewritten section.',
      "At most 12 edits, most important first. Each find is the SHORTEST exact span copied from the section that is unique there (one sentence or less; never a whole paragraph). replace is the new text, or empty to delete. Each find must appear exactly once.",
    ].filter(Boolean).join(" "),
    user: `ISSUES:\n${issues || "(general literary tightening)"}\n\nSECTION:\n---\n${text}\n---`,
  };
}
