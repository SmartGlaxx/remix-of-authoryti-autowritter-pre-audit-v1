import { describe, it, expect } from "vitest";
import { getAdapter, type AIRequest } from "../../supabase/functions/_shared/ai/providers";
import { requireModel } from "../../supabase/functions/_shared/ai/registry";
import { resolveModelForRole } from "../../supabase/functions/_shared/ai/roles";
import { parseDeepSeekPricingPage } from "../../supabase/functions/_shared/ai/pricing";
import { estimatePipeline } from "../../supabase/functions/_shared/ai/estimate";

async function capture(adapter: string, modelKey: string, req: AIRequest) {
  let url = "", body: any = null;
  const fetch = (async (u: string, init: RequestInit) => { url = u; body = JSON.parse(String(init.body)); return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }); }) as any;
  for await (const _ of getAdapter(adapter as any).stream(req, { model: requireModel(modelKey), apiKey: "k", fetch })) { /* drain */ }
  return { url, body };
}
import { thinkingFor, reasoningFor, type Mode } from "../../supabase/functions/_shared/writers/profiles";
// Adapter mapping per thinking mode (tiers removed; adapters still honour every mode).
const MODES: Record<string, Mode> = { "sophia/maximum": "adaptive", "nora/balanced": "extended", "claire/economy": "non-thinking", "priya/balanced": "medium", "maya/economy": "non-thinking", "elena/economy": "thinking", "daniel/maximum": "high" };
const profileReq = (writer: string, tier: any, _role: any = "writer"): AIRequest => {
  const m = MODES[`${writer}/${tier}`]; void resolveModelForRole;
  return { user: "x", temperature: 0.8, reasoning: reasoningFor(m), thinking: thinkingFor(m) };
};

describe("provider request mapping carries the profile's model + thinking", () => {
  it("Claude (sophia maximum, adaptive) → extended thinking, no temperature", async () => {
    for (const a of ["anthropic", "lovable_gateway"]) {
      const { body } = await capture(a, "anthropic/claude-opus-5-5", profileReq("sophia", "maximum"));
      expect(body.thinking).toEqual({ type: "adaptive" }); expect(body.temperature).toBeUndefined();
    }
  });
  it("Claude Haiku extended (nora balanced) → fixed budget", async () => {
    const { body } = await capture("anthropic", "anthropic/claude-haiku-4-5", profileReq("nora", "balanced"));
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 8000 }); expect(body.max_tokens).toBeGreaterThan(8000);
  });
  it("Gemini Flash non-thinking (claire economy revision) → reasoning_effort none", async () => {
    const { body } = await capture("gemini", "google/gemini-3.8-flash", profileReq("claire", "economy", "editor"));
    expect(body.reasoning_effort).toBe("none");
  });
  it("Gemini Flash effort (priya balanced) → reasoning_effort medium", async () => {
    const { body } = await capture("lovable_gateway", "google/gemini-3.8-flash", profileReq("priya", "balanced"));
    expect(body.reasoning_effort).toBe("medium");
  });
  it("DeepSeek (maya economy non-thinking / elena economy thinking)", async () => {
    expect((await capture("deepseek", "deepseek/deepseek-flash", profileReq("maya", "economy"))).body.thinking).toEqual({ type: "disabled" });
    expect((await capture("deepseek", "deepseek/deepseek-flash", profileReq("elena", "economy"))).body.thinking).toEqual({ type: "enabled" });
  });
  it("OpenAI (daniel maximum, high) → reasoning effort high", async () => {
    const { url, body } = await capture("lovable_gateway", "openai/gpt-6-sol", profileReq("daniel", "maximum"));
    expect(url).toMatch(/responses$/); expect(body.reasoning.effort).toBe("high"); expect(body.store).toBe(false);
  });
});

describe("DeepSeek pricing + pipeline cost", () => {
  const page = "<div>PRICING</div><td>1M INPUT TOKENS</td><td>(CACHE HIT)</td><td>OFF-PEAK</td><td>$0.003</td><td>$0.022</td><td>PEAK</td><td>$0.006</td><td>$0.044</td><td>1M INPUT TOKENS</td><td>(CACHE MISS)</td><td>OFF-PEAK</td><td>$0.15</td><td>$0.66</td><td>PEAK</td><td>$0.3</td><td>$1.32</td><td>1M OUTPUT TOKENS</td><td>OFF-PEAK</td><td>$0.6</td><td>$1.98</td><td>PEAK</td><td>$1.2</td><td>$3.96</td>";
  it("parses peak prices for flash and pro", () => {
    const p = parseDeepSeekPricingPage(page);
    expect(p["deepseek/deepseek-flash"]).toMatchObject({ inputPerM: 0.3, cachedInputPerM: 0.006, outputPerM: 1.2 });
    expect(p["deepseek/deepseek-v4-pro"]).toMatchObject({ inputPerM: 1.32, cachedInputPerM: 0.044, outputPerM: 3.96 });
  });
  it("estimates all four pipeline roles for an economy profile", () => {
    const prices = { ...parseDeepSeekPricingPage(page), "openai/gpt-6-luna": { inputPerM: 1, cachedInputPerM: null, cacheWritePerM: null, outputPerM: 4 } };
    const e = estimatePipeline({ mode: "profile", profileWriter: "maya", profileTier: "economy" }, 60000, prices);
    expect(e.roles.map((r) => r.role)).toEqual(["draft", "revision", "continuity", "auditor"]);
    expect(e.totalUsd).toBeGreaterThan(0); expect(e.per1kWordsUsd).toBeGreaterThan(0);
  });
});
