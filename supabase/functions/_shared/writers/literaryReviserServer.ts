// Server wiring for the Literary Reviser: exact model, author's own key only, worst-case reserved per call.
import { generateAIText, type AIDeps } from "../ai/client.ts";
import { estimateCostUSD } from "../ai/registry.ts";
import { LITERARY_MAX_OUTPUT, LiteraryBudget, countTokens, literaryCallConfig, type LiteraryPlan } from "./literaryReviser.ts";
import type { RewriteModel } from "./naturalnessRewrite.ts";

export function literaryCaller(plan: LiteraryPlan, ctx: { userId: string; bookId: string | null; deps: AIDeps; budget: LiteraryBudget }): RewriteModel {
  return async (p) => {
    const inTok = countTokens(p.system) + countTokens(p.user);
    const reserved = ctx.budget.reserve(plan, inTok); // throws before any request
    try {
      const { text, meta } = await generateAIText({
        role: "literary_reviser", config: literaryCallConfig(plan), userId: ctx.userId, bookId: ctx.bookId,
        maxRetries: 0, requireUserKey: true,
        request: { system: p.system, user: p.user, maxOutputTokens: LITERARY_MAX_OUTPUT, ...(meta0(plan)) },
      }, ctx.deps);
      if (meta.usedFallback && !plan.fallback) throw new Error("FALLBACK_FORBIDDEN");
      const actual = estimateCostUSD(meta.model, { inputTokens: meta.usage.inputTokens ?? inTok, outputTokens: meta.usage.outputTokens ?? LITERARY_MAX_OUTPUT, cachedInputTokens: meta.usage.cachedInputTokens ?? 0 }) ?? reserved;
      ctx.budget.settle(reserved, Math.min(actual, reserved));
      return { text };
    } catch (e) { throw e; } // failed call: the worst case stays counted
  };
}
const meta0 = (plan: LiteraryPlan) => (plan.model.startsWith("openai/") ? { reasoning: "low" as const } : {});
