import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolveLiteraryReviser, resolveLiteraryMode, literaryCallConfig, LiteraryBudget, buildLiteraryPrompt, DEFAULT_LITERARY_CAP_USD, LITERARY_MAX_OUTPUT } from "../../supabase/functions/_shared/writers/literaryReviser";
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
  it("cost cap is clamped to $2", () => {
    expect(resolveLiteraryReviser({ literaryReviser: { maxCostUsd: 50 } }, null).capUsd).toBe(2);
  });
});

describe("cost safeguards", () => {
  it("own key required: no platform/gateway route", async () => {
    const deps = { env: { LOVABLE_API_KEY: "x" }, getUserKey: async () => null, recordUsage: async () => {} };
    await expect(selectRoute("openai/gpt-6-sol", deps as never, true)).rejects.toThrow(/own/);
    expect((await selectRoute("openai/gpt-6-sol", deps as never)).source).toBe("platform_gateway"); // unchanged elsewhere
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

