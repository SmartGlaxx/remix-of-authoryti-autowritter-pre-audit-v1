import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolveLiteraryReviser, resolveLiteraryMode, literaryCallConfig, LiteraryBudget, buildLiteraryPrompt, DEFAULT_LITERARY_CAP_USD } from "../../supabase/functions/_shared/writers/literaryReviser";
import { resolveModelForRole, LEGACY_ROLE_MODELS } from "../../supabase/functions/_shared/ai/roles";
import { PROFILES } from "../../supabase/functions/_shared/writers/profiles";
import { selectRoute } from "../../supabase/functions/_shared/ai/client";
import { runNaturalnessRewrite } from "../../supabase/functions/_shared/writers/naturalnessRewrite";
import { BudgetGuard, runLiteraryBenchmark, literaryBenchmarkWorstCase, LITERARY_BENCHMARK_CAP_USD, LITERARY_BENCHMARK_MODELS, type ExpCaller } from "../../supabase/functions/_shared/writers/abExperiment";

const B = (() => { try { const t = readFileSync("/mnt/documents/naturalness-ab-test-results_v3.txt", "utf8"); const m = t.match(/=== B\. FLAWED ===\n([\s\S]*?)\n=== /); if (m && m[1].length > 4000) return m[1].trim(); } catch { /* fallback */ } return null; })();
const SYN = Array.from({ length: 10 }, (_, i) => `As the light shifted ${i}, she waited. Mara crossed the room and counted the chairs by the window. "Stay," Theo said. The truth is, nothing had changed in the house.`).join("\n\n");
const draftB = B ?? SYN;
const vp = (t: string) => ({ system: "check", user: t });

describe("role separation", () => {
  it("existing roles keep their models; literary_reviser is separate", () => {
    expect(resolveModelForRole(null, "editor").model).toBe("openai/gpt-6-sol");
    expect(resolveModelForRole(null, "continuity_reviser").model).toBe("openai/gpt-6-sol");
    expect(LEGACY_ROLE_MODELS.literary_reviser).toBe("openai/gpt-6-sol");
  });
  it("in all 48 profiles continuity_reviser and editor still use the profile's own revision slot", () => {
    let n = 0;
    for (const [w, tiers] of Object.entries(PROFILES)) for (const [t, prof] of Object.entries(tiers)) {
      const cfg = { mode: "profile" as const, profileWriter: w, profileTier: t as never };
      expect(resolveModelForRole(cfg, "continuity_reviser").model).toBe(prof.revision.model);
      expect(resolveModelForRole(cfg, "editor").model).toBe(prof.revision.model);
      n++;
    }
    expect(n).toBe(48);
  });
});

describe("author controls", () => {
  it("defaults off, Sol-like resolution, default cap", () => {
    const p = resolveLiteraryReviser(undefined, null);
    expect(p).toMatchObject({ mode: "off", model: "openai/gpt-6-sol", fallback: null, capUsd: DEFAULT_LITERARY_CAP_USD });
  });
  it("author picks Astra or Fable; unknown models ignored", () => {
    expect(resolveLiteraryReviser({ literaryReviser: { mode: "automatic", model: "anthropic/claude-fable-5-1" } }, null).model).toBe("anthropic/claude-fable-5-1");
    expect(resolveLiteraryReviser({ literaryReviser: { model: "openai/gpt-6-luna" } }, null).model).toBe("openai/gpt-6-sol");
    expect(resolveLiteraryMode({ literaryReviser: { mode: "on_request" } })).toBe("on_request");
    expect(resolveLiteraryMode({ literaryReviser: { mode: "yes" } })).toBe("off");
  });
  it("fallback only when configured AND authorized", () => {
    const a = resolveLiteraryReviser({ literaryReviser: { model: "openai/gpt-6-astra", fallback: "openai/gpt-6-sol" } }, null);
    expect(a.fallback).toBeNull();
    expect(literaryCallConfig(a).fallbacks).toEqual({});
    const b = resolveLiteraryReviser({ literaryReviser: { model: "openai/gpt-6-astra", fallback: "openai/gpt-6-sol", fallbackAuthorized: true } }, null);
    expect(b.fallback).toBe("openai/gpt-6-sol");
  });
  it("cost cap is clamped to $2", () => {
    expect(resolveLiteraryReviser({ literaryReviser: { maxCostUsd: 50 } }, null).capUsd).toBe(2);
  });
});

describe("cost safeguards", () => {
  it("refuses a call whose worst case exceeds the section ceiling", () => {
    const plan = resolveLiteraryReviser({ literaryReviser: { model: "openai/gpt-6-astra", maxCostUsd: 0.05 } }, null);
    expect(() => new LiteraryBudget(plan.capUsd).reserve(plan, 2000)).toThrow(/LITERARY_CAP_EXCEEDED/); // 1500×$50/M = $0.075
  });
  it("reservation covers the authorized fallback too", () => {
    const plan = { mode: "automatic" as const, model: "openai/gpt-6-sol", fallback: "anthropic/claude-fable-5-1", capUsd: 1, maxAttempts: 2 };
    expect(new LiteraryBudget(1).reserve(plan, 1000)).toBeCloseTo((1000 * 10 + 1500 * 50) / 1e6, 9);
  });
  it("own key required: no platform/gateway route", async () => {
    const deps = { env: { LOVABLE_API_KEY: "x" }, getUserKey: async () => null, recordUsage: async () => {} };
    await expect(selectRoute("openai/gpt-6-astra", deps as never, true)).rejects.toThrow(/own/);
    expect((await selectRoute("openai/gpt-6-astra", deps as never)).source).toBe("platform_gateway"); // unchanged elsewhere
  });
});

describe("prompt and engine", () => {
  it("prompt freezes dialogue and makes no subtext claim", () => {
    const s = buildLiteraryPrompt("x", []).system;
    expect(s).toMatch(/DIALOGUE IS FROZEN/);
    expect(s).toMatch(/Do not claim or attempt dialogue or subtext/);
  });
  it("dialogue edits are still rejected and 20% cap still applies", async () => {
    const m = async () => ({ text: JSON.stringify({ edits: [{ find: '"Stay," Theo said.', replace: '"Go," Theo said.' }] }) });
    const r = await runNaturalnessRewrite(SYN, { mode: "analyze_and_rewrite", promptBuilder: buildLiteraryPrompt, maxAttempts: 1 }, m);
    expect(r.changed).toBe(false);
    const big = async () => ({ text: JSON.stringify({ edits: [{ find: SYN.slice(0, 600), replace: "She sat." }] }) });
    const r2 = await runNaturalnessRewrite(SYN, { mode: "analyze_and_rewrite", promptBuilder: buildLiteraryPrompt, maxAttempts: 1 }, big);
    expect(r2.changed).toBe(false);
  });
  it("maxAttempts 1 makes exactly one model call", async () => {
    let n = 0; await runNaturalnessRewrite(SYN, { mode: "analyze_and_rewrite", maxAttempts: 1 }, async () => { n++; return { text: "{}" }; });
    expect(n).toBe(1);
  });
});

describe("Astra vs Fable benchmark (mocked, no paid calls)", () => {
  it("uses the real Draft B when available", () => { if (B) expect(B.length).toBeGreaterThan(5000); });
  it("worst case for Draft B fits $0.21", () => {
    console.log("WORST_CASE", JSON.stringify(literaryBenchmarkWorstCase(draftB, vp)), "realB:", !!B, draftB.length);
    const w = literaryBenchmarkWorstCase(draftB, vp);
    expect(w.total).toBeLessThanOrEqual(LITERARY_BENCHMARK_CAP_USD);
  });
  it("one reviser call per model, same prompt, exact models, validator each", async () => {
    const calls: { model: string; user: string }[] = [];
    const caller: ExpCaller = async (r) => { calls.push({ model: r.model, user: r.user }); return { text: r.model.includes("luna") ? "PASS" : '{"edits":[]}', inputTokens: 100, outputTokens: 50, modelUsed: r.model }; };
    const r = await runLiteraryBenchmark({ flawed: draftB, validatorPrompt: vp }, caller);
    const rev = calls.filter((c) => c.model !== LITERARY_BENCHMARK_MODELS.validator);
    expect(rev.map((c) => c.model)).toEqual([LITERARY_BENCHMARK_MODELS.astra, LITERARY_BENCHMARK_MODELS.fable]);
    expect(rev[0].user).toBe(rev[1].user);
    expect(calls.filter((c) => c.model === LITERARY_BENCHMARK_MODELS.validator)).toHaveLength(2);
    expect(r.totalUSD).toBeLessThan(LITERARY_BENCHMARK_CAP_USD);
  });
  it("a substituted model is refused", async () => {
    const caller: ExpCaller = async (r) => ({ text: "{}", inputTokens: 10, outputTokens: 10, modelUsed: "openai/gpt-6-sol" });
    const r = await runLiteraryBenchmark({ flawed: draftB, validatorPrompt: vp }, caller);
    expect(r.arms.astra.aborted).toMatch(/FALLBACK_FORBIDDEN/);
    expect(r.arms.fable.aborted).toMatch(/FALLBACK_FORBIDDEN/);
  });
  it("aborts with no calls if the cap is too small", async () => {
    let n = 0; const caller: ExpCaller = async (r) => { n++; return { text: "", inputTokens: 1, outputTokens: 1, modelUsed: r.model }; };
    const r = await runLiteraryBenchmark({ flawed: draftB, validatorPrompt: vp }, caller, new BudgetGuard(0.05));
    expect(r.aborted).toMatch(/WORST_CASE_EXCEEDS_CAP/); expect(n).toBe(0);
  });
});
