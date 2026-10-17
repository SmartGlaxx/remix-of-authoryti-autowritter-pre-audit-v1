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
  it("full worst-case run fits inside $0.10", () => {
    const g = new BudgetGuard();
    g.reserve(EXPERIMENT_MODELS.writer, 3000, 1600);
    for (let i = 0; i < 2; i++) g.reserve(EXPERIMENT_MODELS.rewriter, 3000, 600);
    for (let i = 0; i < 2; i++) g.reserve(EXPERIMENT_MODELS.validator, 3000, 300);
    expect(g.reservedOpen).toBeLessThan(0.10);
  });
});

describe("flaw injection preflight", () => {
  it("flawed copy triggers starters ≥4, verbatim duplicate and stock phrases", () => {
    const r = preflightDetection(injectFlaws(PARAS));
    expect(r.checks).toEqual({ repeatedStarters: true, verbatimDuplicate: true, stockPhrases: true });
  });
  it("original is left unchanged", () => { const a = PARAS; injectFlaws(a); expect(a).toBe(PARAS); });
});

describe("experiment run (mock, zero cost)", () => {
  it("returns all three texts, one generation, usage and totals under cap", async () => {
    const { caller, calls } = mock();
    const r = await runExperiment({ writerPrompt: { system: "s", user: "u" }, validatorPrompt: (t) => ({ system: "v", user: t }) }, caller);
    expect(r.aborted).toBeUndefined();
    expect(r.textA_original).toBe(PARAS);
    expect(r.textB_flawed).not.toBe(PARAS);
    expect(r.textC_revised).not.toContain("The truth is, nothing");
    expect(calls.filter((m) => m === EXPERIMENT_MODELS.writer)).toHaveLength(1);
    expect(calls.filter((m) => m === EXPERIMENT_MODELS.rewriter).length).toBeLessThanOrEqual(2);
    expect(r.totalUSD).toBeLessThanOrEqual(0.10);
    expect(r.usage.length).toBe(calls.length);
  });
});
