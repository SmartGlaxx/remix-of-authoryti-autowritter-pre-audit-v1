// Rough pre-flight cost estimates from the pricing registry. Token counts are heuristics
// (≈1.35 tokens/word) and results are labelled as estimates; unknown pricing → null.
import { estimateCostUSD, getModel } from "./registry.ts";
import { resolveModelForRole, type BookModelConfig } from "./roles.ts";
import type { PriceMap } from "./pricing.ts";

export interface OperationEstimate {
  operation: "outline" | "chapter" | "manuscript_audit";
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
  note: string;
}

const TOKENS_PER_WORD = 1.35;

// deno-lint-ignore no-explicit-any
export function estimateOperationCosts(config: BookModelConfig | null | undefined, outline?: any, live?: PriceMap): OperationEstimate[] {
  const chapters: any[] = outline?.chapters ?? [];
  const subsPerChapter = chapters.length ? Math.max(1, Math.round(chapters.reduce((n, c) => n + (c?.subsections?.length ?? 0), 0) / chapters.length)) : 4;
  const wordsPerSub = 600;
  const totalWords = Math.max(1, chapters.length) * subsPerChapter * wordsPerSub;

  const mk = (operation: OperationEstimate["operation"], role: Parameters<typeof resolveModelForRole>[1], input: number, output: number, note: string): OperationEstimate => {
    const model = resolveModelForRole(config, role).model;
    const lp = live?.[model];
    if (lp && lp.inputPerM != null && lp.outputPerM != null) {
      const cost = Math.round(((input * lp.inputPerM + output * lp.outputPerM) / 1e6) * 1e6) / 1e6;
      return { operation, model, inputTokens: Math.round(input), outputTokens: Math.round(output), estimatedCostUsd: cost, note: note + " (live price)" };
    }
    const known = getModel(model)?.pricing.inputPerM != null && getModel(model)?.pricing.outputPerM != null;
    return { operation, model, inputTokens: Math.round(input), outputTokens: Math.round(output), estimatedCostUsd: known ? estimateCostUSD(model, { inputTokens: Math.round(input), outputTokens: Math.round(output), cachedInputTokens: 0 }) : null, note: known ? note : "Pricing not available for this model" };
  };

  return [
    mk("outline", "planner", 2500, 4000, "Estimate — actual usage is recorded after each call"),
    // each section sends the system prompt + story memory + prior text (capped ~25k tokens)
    mk("chapter", "writer", subsPerChapter * 20000, subsPerChapter * wordsPerSub * TOKENS_PER_WORD, "Estimate without cache discounts"),
    mk("manuscript_audit", "manuscript_auditor", totalWords * TOKENS_PER_WORD, 6000, "Whole-book audit (on demand)"),
  ];
}

// ── Pipeline estimate: Draft → Revision → Continuity → Auditor for the configured roles ──
export interface PipelineRoleCost { role: "draft" | "revision" | "continuity" | "auditor"; model: string; thinking: boolean; costUsd: number | null; per1kWordsUsd: number | null }
export interface PipelineEstimate { totalWords: number; roles: PipelineRoleCost[]; per1kWordsUsd: number | null; totalUsd: number | null; note: string }

const SECTION_WORDS = 600;
/** Thinking/reasoning tokens are billed as output by every provider we use; assume +50% output when on. */
const THINKING_OUTPUT_FACTOR = 1.5;

/** Share of each call's input that is a repeated, cacheable prefix (system prompt, persona, plan, story memory). */
export const CACHED_INPUT_SHARE = 0.6;

function priceOf(model: string, live?: PriceMap): { inputPerM: number; outputPerM: number; cachedPerM: number } | null {
  const reg = getModel(model)?.pricing;
  const lp = live?.[model];
  const base = lp?.inputPerM != null && lp?.outputPerM != null ? { inputPerM: lp.inputPerM, outputPerM: lp.outputPerM }
    : reg?.inputPerM != null && reg?.outputPerM != null ? { inputPerM: reg.inputPerM, outputPerM: reg.outputPerM } : null;
  if (!base) return null;
  return { ...base, cachedPerM: reg?.cachedInputPerM ?? base.inputPerM };
}

/** Cache-aware input cost: the repeated prefix is billed at the cached rate. */
export function cachedInputCost(inputTokens: number, p: { inputPerM: number; cachedPerM: number }, share = CACHED_INPUT_SHARE): number {
  return (inputTokens * (1 - share) * p.inputPerM + inputTokens * share * p.cachedPerM) / 1e6;
}

export function estimatePipeline(config: BookModelConfig | null | undefined, totalWords: number, live?: PriceMap): PipelineEstimate {
  const words = Math.max(SECTION_WORDS, Math.round(totalWords));
  const sections = Math.ceil(words / SECTION_WORDS);
  const outTok = words * TOKENS_PER_WORD;
  // [pipeline role, executing role, input tokens, output tokens, counted in total]. The whole-book audit is optional.
  const plan: [PipelineRoleCost["role"], Parameters<typeof resolveModelForRole>[1], number, number, boolean][] = [
    ["draft", "writer", sections * 20000, outTok, true],
    ["revision", "editor", sections * 3000 + outTok, outTok, true],
    ["continuity", "continuity_checker", sections * 8000 + outTok, sections * 800, true],
    ["auditor", "manuscript_auditor", outTok + 4000, 6000, false],
  ];
  const roles = plan.map(([role, exec, inp, out]) => {
    const r = resolveModelForRole(config, exec);
    const thinking = !!(r.thinking || r.reasoning);
    const pr = priceOf(r.model, live);
    // Thinking surcharge only for the drafting role; checks are short structured verdicts.
    const outFactor = thinking && role === "draft" ? THINKING_OUTPUT_FACTOR : 1;
    const cost = pr ? cachedInputCost(inp, pr) + (out * outFactor * pr.outputPerM) / 1e6 : null;
    return { role, model: r.model, thinking, costUsd: cost == null ? null : Math.round(cost * 1e4) / 1e4, per1kWordsUsd: cost == null ? null : Math.round((cost / words) * 1000 * 1e4) / 1e4 };
  });
  const counted = roles.filter((_, i) => plan[i][4]);
  const known = counted.every((r) => r.costUsd != null);
  const total = known ? counted.reduce((n, r) => n + r.costUsd!, 0) : null;
  return { totalWords: words, roles, totalUsd: total == null ? null : Math.round(total * 100) / 100, per1kWordsUsd: total == null ? null : Math.round((total / words) * 1000 * 1e4) / 1e4, note: "Estimate with prompt-cache discounts on repeated context; the optional whole-book audit is shown but not included in the total." };
}
