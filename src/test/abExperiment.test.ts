import { describe, it, expect } from "vitest";
import { BudgetGuard, BudgetExceededError, guardedCall, injectFlaws, preflightDetection, runExperiment, EXPERIMENT_MODELS, type ExpCaller } from "../../supabase/functions/_shared/writers/abExperiment";

const PARAS = Array.from({ length: 8 }, (_, i) => `Mara crossed room ${i + 1} and counted the chairs. Her brother had left the window open, and cold air moved the curtains in slow folds. She closed it with care.`).join("\n\n");

const mock = (overrides: Partial<Record<string, string>> = {}): { caller: ExpCaller; calls: string[] } => {
  const calls: string[] = [];
  return { calls, caller: async (r) => {
    calls.push(r.model);
    const text = r.model === EXPERIMENT_MODELS.writer ? PARAS : r.model === EXPERIMENT_MODELS.rewriter ? '{"edits":[{"find":"The truth is, nothing","replace":"Still, nothing"}]}' : "OK";
    return { text, inputTokens: 100, outputTokens: Math.min(50, r.maxOutputTokens), modelUsed: overrides[r.model] ?? r.model };
  } };
};

describe("experiment budget cap ($0.10)", () => {
  it("refuses before sending when the worst-case reservation exceeds the cap", async () => {
    const g = new BudgetGuard(0.01); const { caller, calls } = mock();
    // Sonnet 5: 1,600 max output × $10/M = $0.016 > $0.01
    await expect(guardedCall(g, caller, "writer")({ system: "s", user: "u" })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(calls).toHaveLength(0);
  });
  it("counts actual input size in the reservation", () => {
    const g = new BudgetGuard(0.10);
    expect(() => g.reserve("anthropic/claude-sonnet-5", 50_000, 1600)).toThrow(BudgetExceededError); // $0.10 + $0.016
  });
  it("includes provider markup", () => {
    expect(new BudgetGuard(0.1, 1.5).worstCase("openai/gpt-6-sol", 1000, 600)).toBeCloseTo(((1000 * 2 + 600 * 10) / 1e6) * 1.5, 9);
  });
  it("refuses unpriced models instead of guessing", () => {
    expect(() => new BudgetGuard().reserve("deepseek/deepseek-flash", 10, 10)).toThrow(/PRICE_UNKNOWN/);
  });
  it("rejects a provider fallback to a different model", async () => {
    const { caller } = mock({ [EXPERIMENT_MODELS.writer]: "openai/gpt-6-sol" });
    await expect(guardedCall(new BudgetGuard(), caller, "writer")({ system: "s", user: "u" })).rejects.toThrow(/FALLBACK_FORBIDDEN/);
  });
});

describe("flaw injection preflight", () => {
  it("flawed copy triggers starters ≥4, verbatim duplicate and stock phrases", () => {
    const r = preflightDetection(injectFlaws(PARAS));
    expect(r.checks).toEqual({ repeatedStarters: true, verbatimDuplicate: true, stockPhrases: true });
  });
  it("original is left unchanged", () => { const a = PARAS; injectFlaws(a); expect(a).toBe(PARAS); });
});


describe("flaw injection scales to long drafts", () => {
  it("clears the 15% starter threshold on a 40-sentence draft", () => {
    const long = Array.from({ length: 10 }, (_, i) => `Mara stood by window ${i}. Wind moved the reeds. A boat knocked the dock. Theo said nothing for a while.`).join("\n\n");
    expect(preflightDetection(injectFlaws(long)).checks.repeatedStarters).toBe(true);
  });
  it("reusing a paid original makes no writer call", async () => {
    const { caller, calls } = mock();
    await runExperiment({ writerPrompt: { system: "s", user: "u" }, reuseOriginal: PARAS, validatorPrompt: (t) => ({ system: "v", user: t }) }, caller);
    expect(calls.includes(EXPERIMENT_MODELS.writer)).toBe(false);
  });
});
