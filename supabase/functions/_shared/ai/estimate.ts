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
