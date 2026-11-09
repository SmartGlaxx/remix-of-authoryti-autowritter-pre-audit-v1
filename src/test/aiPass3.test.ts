import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { MODEL_REGISTRY, getModel, estimateCostUSD, ACTIVE_ROLES } from "../../supabase/functions/_shared/ai/registry";
import { resolveModelForRole, OPTIMIZED_ROLE_MODELS, LEGACY_ROLE_MODELS, normalizeConfig } from "../../supabase/functions/_shared/ai/roles";
import { ADAPTERS, AIProviderError, maskKey, scrubSecrets } from "../../supabase/functions/_shared/ai/providers";
import { streamAI, generateAIText, selectRoute, toChatSSE, type AIDeps, type UsageRecord } from "../../supabase/functions/_shared/ai/client";
import { encryptKey, decryptKey } from "../../supabase/functions/_shared/ai/keyCrypto";
import { estimateOperationCosts } from "../../supabase/functions/_shared/ai/estimate";

const sse = (lines: string[], status = 200, headers: Record<string, string> = {}) =>
  new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); for (const l of lines) c.enqueue(e.encode(l)); c.close(); } }), { status, headers: { "content-type": "text/event-stream", ...headers } });

const respSSE = (text: string) => sse([`data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\n`, `data: ${JSON.stringify({ type: "response.completed", response: { id: "r1", usage: { input_tokens: 5, output_tokens: 1 } } })}\n\n`]);
const chatSSE = (text: string, usage?: object) => sse([
  `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "thinking…" } }] })}\n\n`,
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
  ...(usage ? [`data: ${JSON.stringify({ id: "req_1", choices: [], usage })}\n\n`] : []),
  "data: [DONE]\n\n",
]);

function makeDeps(fetchImpl: typeof fetch, over: Partial<AIDeps> = {}, userKeys: Record<string, string> = {}) {
  const usage: UsageRecord[] = [];
  const logs: string[] = [];
  const deps: AIDeps = {
    env: { LOVABLE_API_KEY: "lov_platform_key_123456", DEEPSEEK_API_KEY: "sk-platformdeepseek123456" },
    getUserKey: async (p) => userKeys[p] ?? null,
    recordUsage: async (r) => { usage.push(r); },
    fetch: fetchImpl,
    sleep: async () => {},
    log: (m) => logs.push(m),
    ...over,
  };
  return { deps, usage, logs };
}

describe("Pass 3 — registry", () => {
  it("1. resolves models and required providers", () => {
    expect(MODEL_REGISTRY.map((m) => m.key).sort()).toEqual(["anthropic/claude-sonnet-5", "openai/gpt-6-sol"]);
    expect(getModel("nope")).toBeUndefined();
    expect(new Set(MODEL_REGISTRY.map((m) => m.key)).size).toBe(MODEL_REGISTRY.length);
  });
  it("2. every provider has an adapter", () => {
    for (const m of MODEL_REGISTRY) expect(ADAPTERS[m.provider]).toBeTruthy();
    expect(ADAPTERS.lovable_gateway).toBeTruthy();
  });
});

describe("Pass 3 — role resolution", () => {
  it("normalizes junk and unknown models to safe defaults", () => {
    expect(normalizeConfig(null).mode).toBe("profile");
    expect(normalizeConfig({ mode: "custom", role_models: { writer: "evil/model" } }).roleModels).toEqual({});
  });
  it("future roles never execute", async () => {
    const { deps } = makeDeps(vi.fn() as never);
    expect(ACTIVE_ROLES).toContain("manuscript_auditor"); // activated in Pass 5
    expect(ACTIVE_ROLES).not.toContain("difficult_chapter");
    await expect(generateAIText({ role: "difficult_chapter", config: null, userId: "u", request: { user: "x" } }, deps)).rejects.toMatchObject({ code: "inactive_role" });
  });
});

describe("Pass 3 — existing providers", () => {
  it("6. default config never routes any role to Gemini", () => {
    for (const role of Object.keys(LEGACY_ROLE_MODELS) as (keyof typeof LEGACY_ROLE_MODELS)[]) {
      expect(resolveModelForRole(null, role).model.startsWith("google/")).toBe(false);
      expect(resolveModelForRole(null, role).fallback?.startsWith("google/") ?? false).toBe(false);
    }
    expect(resolveModelForRole(null, "summarizer").model).toBe("openai/gpt-6-sol");
  });
  it("OpenAI models go through the Responses API with store=false", async () => {
    const f = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://ai.gateway.lovable.dev/v1/responses");
      const b = JSON.parse(init.body as string);
      expect(b.store).toBe(false);
      expect(b.temperature).toBeUndefined();
      return sse([`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Ok" })}\n\n`, `data: ${JSON.stringify({ type: "response.completed", response: { id: "r1", usage: { input_tokens: 5, output_tokens: 1 } } })}\n\n`]);
    });
    const { deps, usage } = makeDeps(f as never);
    const r = await generateAIText({ role: "editor", config: null, userId: "u", request: { user: "x", temperature: 0.7 } }, deps);
    expect(r.text).toBe("Ok");
    expect(usage[0]).toMatchObject({ model: "openai/gpt-6-sol", inputTokens: 5, outputTokens: 1, cachedInputTokens: null, requestId: "r1" });
  });
});

describe("Pass 3 — BYOK", () => {
  it("7. missing user key produces a controlled error", async () => {
    const { deps } = makeDeps(vi.fn() as never, { env: {} });
    await expect(generateAIText({ role: "editor", config: null, userId: "u", request: { user: "x" } }, deps)).rejects.toBeInstanceOf(AIProviderError);
  });
  it("8. invalid user key → controlled error, no silent switch, key not leaked", async () => {
    const userKey = "sk-userkey-ABCDEFGHIJKLMNOP1234";
    const f = vi.fn(async () => new Response(`{"error":"bad key ${userKey}"}`, { status: 401 }));
    const { deps, usage, logs } = makeDeps(f as never, {}, { openai: userKey });
    const err = await generateAIText({ role: "editor", config: null, userId: "u", request: { user: "x" } }, deps).catch((e) => e);
    expect(err).toMatchObject({ code: "auth" });
    expect(String(err.message)).not.toContain(userKey);
    expect(f).toHaveBeenCalledTimes(1); // no fallback configured → no second provider
    expect(usage[0]).toMatchObject({ success: false, credentialSource: "user_key", errorCode: "auth" });
    expect(JSON.stringify(usage) + logs.join()).not.toContain(userKey);
  });
  it("9. one user's ciphertext cannot be decrypted as another user", async () => {
    const secret = "x".repeat(64);
    const { ciphertext, iv } = await encryptKey(secret, "user-a", "sk-secret-value-1234567890");
    expect(await decryptKey(secret, "user-a", ciphertext, iv)).toBe("sk-secret-value-1234567890");
    await expect(decryptKey(secret, "user-b", ciphertext, iv)).rejects.toBeTruthy();
    expect(ciphertext).not.toContain("secret-value");
  });
  it("9b. server key loader is scoped to the caller's user id", () => {
    const src = readFileSync("supabase/functions/_shared/ai/server.ts", "utf8");
    expect(src).toMatch(/from\("user_provider_keys"\)[\s\S]*?\.eq\("user_id", userId\)/);
  });
  it("10. client responses only contain masked keys", () => {
    const m = maskKey("sk-proj-abcdefghijklmnop1234");
    expect(m.masked).toBe("sk-proj-••••••••1234");
    const src = readFileSync("supabase/functions/provider-keys/index.ts", "utf8");
    expect(src).not.toMatch(/json\([^)]*ciphertext/);
    expect(src).not.toMatch(/json\([^)]*rawKey/);
  });
  it("11. secrets are scrubbed from logged text", () => {
    const k = "sk-ant-api03-SECRETSECRETSECRET";
    const out = scrubSecrets(`failed with ${k} and Bearer abcdefghijklmnop and AIzaSyA1234567890abcdefghijk`, k);
    expect(out).not.toContain("SECRETSECRET");
    expect(out).not.toContain("abcdefghijklmnop");
    expect(out).not.toContain("AIzaSy");
  });
});

describe("Pass 3 — usage and cost", () => {
  it("12/13. usage recorded; unknown tokens stay null (not fabricated)", async () => {
    const { deps, usage } = makeDeps(vi.fn(async () => chatSSE("x")) as never);
    await generateAIText({ role: "planner", config: null, userId: "u", bookId: "b", request: { user: "x" } }, deps);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ userId: "u", bookId: "b", role: "planner", success: true, inputTokens: null, outputTokens: null, estimatedCostUsd: null });
  });
  it("14. cost uses the central pricing registry", () => {
    // gpt-6-sol: $2/M input, $0.2/M cached, $10/M output
    expect(estimateCostUSD("openai/gpt-6-sol", { inputTokens: 1_000_000, cachedInputTokens: 500_000, outputTokens: 100_000 })).toBeCloseTo(1 + 0.1 + 1, 6);
    expect(estimateCostUSD("google/gemini-3.8-flash", { inputTokens: 10, outputTokens: 10, cachedInputTokens: 0 })).toBeNull(); // removed model
    const est = estimateOperationCosts({ mode: "optimized" }, { chapters: [{ subsections: [1, 2, 3, 4] }] });
    expect(est.find((e) => e.operation === "chapter")?.model).toBe("anthropic/claude-sonnet-5");
  });
  it("transient 429 retries, then succeeds", async () => {
    let n = 0;
    const f = vi.fn(async () => (++n === 1 ? new Response("slow down", { status: 429 }) : respSSE("ok")));
    const { deps } = makeDeps(f as never);
    expect((await generateAIText({ role: "planner", config: null, userId: "u", request: { user: "x" } }, deps)).text).toBe("ok");
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("toChatSSE keeps the existing client stream format", async () => {
    async function* g() { yield "a"; yield "b"; }
    let full = "";
    const text = await new Response(toChatSSE(g(), (t) => { full = t; })).text();
    expect(text).toContain(`"delta":{"content":"a"}`);
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
    expect(full).toBe("ab");
  });
});

describe("Pass 3 — pipeline wiring (15–21)", () => {
  const gen = readFileSync("supabase/functions/generate-content/index.ts", "utf8");
  const hook = readFileSync("src/hooks/useBookGeneration.ts", "utf8");
  it("15/16. writer goes through the abstraction and still receives story memory first", () => {
    expect(gen).toContain('role: "writer"');
    expect(gen.indexOf("buildNarrativeContext(")).toBeLessThan(gen.indexOf("streamAI("));
    expect(gen).not.toContain("api.deepseek.com");
    expect(gen).not.toContain("ai.gateway.lovable.dev");
  });
  it("17. extraction still runs after each saved section in both loops, via the AI layer", () => {
    expect(hook.match(/runNarrativeExtraction\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(readFileSync("supabase/functions/extract-narrative-state/index.ts", "utf8")).toContain('role: "narrative_extractor"');
  });
  it("18–21. all four writing modes still branch in the generation hook", () => {
    for (const m of ['"guided"', '"assisted"', '"semi-auto"', '"auto-draft"']) expect(hook).toContain(m);
    expect(readFileSync("supabase/functions/rewrite-paragraph/index.ts", "utf8")).toContain('role: "editor"');
  });
  it("no other migrated function calls a provider directly", () => {
    for (const f of ["generate-outline", "generate-intro", "rewrite-paragraph", "summarize-content", "extract-narrative-state"]) {
      const s = readFileSync(`supabase/functions/${f}/index.ts`, "utf8");
      expect(s).not.toContain("ai.gateway.lovable.dev");
      expect(s).not.toContain("api.deepseek.com");
    }
  });
});
