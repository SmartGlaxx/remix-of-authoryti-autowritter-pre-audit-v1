// Provider adapters. Each adapter owns URL, auth, request shape, stream parsing,
// usage extraction and error normalization. Nothing outside this file knows a provider's wire format.
// Runtime-neutral (no Deno globals) so it runs in edge functions and in tests.
import type { ModelInfo, ProviderId } from "./registry.ts";

export interface AIRequest {
  system?: string;
  user: string;
  /** Owner-authorized image inputs, supported only on OpenAI Responses. */
  images?: string[];
  json?: boolean;
  /** Opt-in strict shape for structured Responses calls; other callers remain unchanged. */
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  reasoning?: "low" | "medium" | "high";
  /** DeepSeek V4 thinking mode (model parameter, not a separate model id). undefined = provider default. */
  /** Thinking switch: true/false, or "deep" for a larger budget (Claude adaptive). undefined = provider default. */
  thinking?: boolean | "deep";
  maxOutputTokens?: number;
}

export interface Usage {
  /** Total input tokens including cached ones; null = provider did not report. */
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  /** Anthropic only: tokens written to the prompt cache on this call (billed at 1.25× input). */
  cacheWriteInputTokens?: number | null;
  requestId: string | null;
  /** Why generation stopped, normalised: "complete" | "max_tokens" | other provider reason. */
  stopReason?: string | null;
}

export type AIEvent = { type: "text"; text: string } | { type: "usage"; usage: Partial<Usage> };

export type AIErrorCode = "test_mode_blocked" | "missing_key" | "auth" | "rate_limit" | "payment" | "forbidden" | "bad_request" | "unavailable" | "network" | "inactive_role" | "unknown";

export class AIProviderError extends Error {
  constructor(public code: AIErrorCode, message: string, public status: number | null = null, public retryable = false) {
    super(message);
    this.name = "AIProviderError";
  }
}

export type AdapterId = "lovable_gateway" | ProviderId;

export interface CallContext {
  model: ModelInfo;
  apiKey: string;
  fetch: typeof fetch;
  signal?: AbortSignal;
  runId?: string;
}

export interface ProviderAdapter {
  id: AdapterId;
  stream(req: AIRequest, ctx: CallContext): AsyncGenerator<AIEvent>;
}

// ── Secret scrubbing — applied to every provider error message ──
const KEY_PATTERNS = [/sk-[A-Za-z0-9_\-]{8,}/g, /sk-ant-[A-Za-z0-9_\-]{8,}/g, /AIza[0-9A-Za-z_\-]{20,}/g, /Bearer\s+[A-Za-z0-9._\-]{8,}/gi];
export function scrubSecrets(text: string, ...known: (string | undefined | null)[]): string {
  let out = text;
  for (const k of known) if (k && k.length >= 6) out = out.split(k).join("[redacted]");
  for (const p of KEY_PATTERNS) out = out.replace(p, "[redacted]");
  return out;
}

export function maskKey(key: string): { prefix: string; last4: string; masked: string } {
  const k = key.trim();
  const prefix = /^(sk-ant-|sk-proj-|sk-|AIza)/.exec(k)?.[1] ?? "";
  const last4 = k.slice(-4);
  return { prefix, last4, masked: `${prefix}••••••••${last4}` };
}

// ── SSE parsing ──
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string | null; data: string }> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let event: string | null = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        if (line === "") { event = null; continue; }
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) yield { event, data: line.slice(5).trim() };
      }
    }
    if (buf.startsWith("data:")) yield { event, data: buf.slice(5).trim() };
  } finally {
    reader.releaseLock();
  }
}

async function failFromResponse(res: Response, apiKey: string, provider: string): Promise<never> {
  const body = scrubSecrets((await res.text().catch(() => "")).slice(0, 400), apiKey);
  const s = res.status;
  const label = provider === "lovable_gateway" ? "Built-in AI" : provider;
  if (s === 401) throw new AIProviderError("auth", `${label} rejected the API key`, s);
  if (s === 402) throw new AIProviderError("payment", `${label}: insufficient credits`, s);
  if (s === 403) throw new AIProviderError("forbidden", `${label} denied access: ${body}`, s);
  if (s === 404) throw new AIProviderError("unavailable", `${label}: model or endpoint not available${body ? ` — ${body.slice(0, 200)}` : ""}`, s);
  if (s === 429) throw new AIProviderError("rate_limit", `${label}: rate limited`, s, true);
  if (s >= 500) throw new AIProviderError("unavailable", `${label} error ${s}`, s, true);
  throw new AIProviderError("bad_request", `${label} rejected the request (${s}): ${body}`, s);
}

async function post(ctx: CallContext, url: string, headers: Record<string, string>, body: unknown, provider: string): Promise<Response> {
  let res: Response;
  try {
    res = await ctx.fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctx.signal });
  } catch (e) {
    throw new AIProviderError("network", `Network error reaching ${provider}: ${scrubSecrets(e instanceof Error ? e.message : String(e), ctx.apiKey)}`, null, true);
  }
  if (!res.ok || !res.body) await failFromResponse(res, ctx.apiKey, provider);
  return res;
}

function messagesOf(req: AIRequest) {
  return [...(req.system ? [{ role: "system", content: req.system }] : []), { role: "user", content: req.user }];
}

// ── Wire formats ──

/** OpenAI-compatible Chat Completions (DeepSeek, Gemini-compat, gateway for Gemini). */
async function* chatCompletions(url: string, headers: Record<string, string>, modelId: string, req: AIRequest, ctx: CallContext, provider: string, extra: Record<string, unknown> = {}): AsyncGenerator<AIEvent> {
  const body: Record<string, unknown> = { model: modelId, messages: messagesOf(req), stream: true, stream_options: { include_usage: true }, ...extra };
  if (req.temperature != null && !ctx.model.rejectsSampling) body.temperature = req.temperature;
  if (req.json) body.response_format = { type: "json_object" };
  if (req.maxOutputTokens) body.max_completion_tokens = req.maxOutputTokens; // hard provider-side output cap
  // Gemini (direct or via gateway): thinking/effort → reasoning_effort. Pro models cannot fully disable thinking.
  if (ctx.model.provider === "gemini" && body.reasoning_effort == null) {
    const off = /flash/.test(modelId) ? "none" : "low";
    const eff = req.reasoning ?? (req.thinking === false ? off : req.thinking ? "high" : undefined);
    if (eff) body.reasoning_effort = eff;
  }
  if (ctx.model.provider === "deepseek" && req.thinking && req.reasoning) body.reasoning_effort = req.reasoning === "medium" ? "high" : req.reasoning;
  const res = await post(ctx, url, headers, body, provider);
  const requestId = res.headers.get("x-request-id");
  if (requestId) yield { type: "usage", usage: { requestId } };
  for await (const { data } of sseEvents(res.body!)) {
    if (!data || data === "[DONE]") continue;
    let p: any;
    try { p = JSON.parse(data); } catch { continue; }
    const c = p.choices?.[0]?.delta?.content; // reasoning_content is deliberately ignored
    if (c) yield { type: "text", text: c };
    if (p.usage) {
      const u = p.usage;
      const cached = u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? null;
      yield { type: "usage", usage: { inputTokens: u.prompt_tokens ?? null, outputTokens: u.completion_tokens ?? null, cachedInputTokens: cached, requestId: p.id ?? requestId ?? null } };
    }
  }
}

/** OpenAI Responses API. Stateless: store=false, reasoning carried inline. */
async function* responses(url: string, headers: Record<string, string>, modelId: string, req: AIRequest, ctx: CallContext, provider: string): AsyncGenerator<AIEvent> {
  const body: Record<string, unknown> = {
    model: modelId,
    input: messagesOf(req),
    stream: true,
    store: false,
  };
  if (req.images?.length) body.input = [
    ...(req.system ? [{ role: 'system', content: req.system }] : []),
    { role: 'user', content: [{ type: 'input_text', text: req.user }, ...req.images.map(image_url => ({ type: 'input_image', image_url }))] },
  ];
  if (ctx.model.reasoningControls) {
    body.reasoning = { effort: req.reasoning ?? "medium", summary: "auto" };
    body.include = ["reasoning.encrypted_content"];
  }
  if (req.temperature != null && !ctx.model.rejectsSampling) body.temperature = req.temperature;
  if (req.jsonSchema) body.text = { format: { type: "json_schema", name: "initial_idea", strict: true, schema: req.jsonSchema } };
  else if (req.json) body.text = { format: { type: "json_object" } };
  if (req.maxOutputTokens) body.max_output_tokens = req.maxOutputTokens; // includes reasoning tokens
  const res = await post(ctx, url, headers, body, provider);
  for await (const { event, data } of sseEvents(res.body!)) {
    if (!data || data === "[DONE]") continue;
    let p: any;
    try { p = JSON.parse(data); } catch { continue; }
    const type = p.type ?? event;
    if (type === "response.output_text.delta" && p.delta) yield { type: "text", text: p.delta };
    else if (type === "response.completed" || type === "response.incomplete") {
      const u = p.response?.usage;
      const why = type === "response.completed" ? "complete" : (p.response?.incomplete_details?.reason === "max_output_tokens" ? "max_tokens" : String(p.response?.incomplete_details?.reason ?? "incomplete"));
      yield { type: "usage", usage: { inputTokens: u?.input_tokens ?? null, outputTokens: u?.output_tokens ?? null, cachedInputTokens: u?.input_tokens_details?.cached_tokens ?? null, requestId: p.response?.id ?? null, stopReason: why } };
    } else if (type === "response.failed" || type === "error") {
      const msg = scrubSecrets(String(p.response?.error?.message ?? p.error?.message ?? p.message ?? "stream failed"), ctx.apiKey);
      throw new AIProviderError("unavailable", `${provider}: ${msg}`, null, false);
    }
  }
}

/** Anthropic Messages API. */
async function* messages(url: string, headers: Record<string, string>, modelId: string, req: AIRequest, ctx: CallContext, provider: string): AsyncGenerator<AIEvent> {
  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: req.maxOutputTokens ?? 16000,
    messages: [{ role: "user", content: req.user }],
    stream: true,
  };
  // Explicit prompt caching: the system prompt is the STATIC prefix (writer persona, style fingerprint,
  // voice manifest, rules). Marking it ephemeral lets Anthropic cache it (90% read discount, 1.25× write
  // cost, 5-min TTL). Below the model's minimum cacheable length Anthropic silently skips caching — no error.
  if (req.system) body.system = [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }];
  if (req.thinking) {
    // Extended thinking: budget must be below max_tokens and sampling params must be unset.
    // "deep" = adaptive thinking (Opus 5.x rejects fixed budgets); true = fixed-budget extended thinking.
    if (req.thinking === "deep") { body.thinking = { type: "adaptive" }; body.max_tokens = Math.max(Number(body.max_tokens), 32000); }
    else { body.max_tokens = Math.max(Number(body.max_tokens), 16000); body.thinking = { type: "enabled", budget_tokens: 8000 }; }
  }
  // Newer Claude models reject `temperature` ("deprecated for this model"); Anthropic calls never send sampling params.
  const res = await post(ctx, url, { "anthropic-version": "2023-06-01", ...headers }, body, provider);
  let input: number | null = null, cached: number | null = null, cacheWrite: number | null = null, requestId: string | null = null;
  for await (const { data } of sseEvents(res.body!)) {
    if (!data) continue;
    let p: any;
    try { p = JSON.parse(data); } catch { continue; }
    if (p.type === "message_start") {
      const u = p.message?.usage ?? {};
      cached = u.cache_read_input_tokens ?? null;
      cacheWrite = u.cache_creation_input_tokens ?? null;
      input = u.input_tokens != null ? u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : null;
      requestId = p.message?.id ?? null;
    } else if (p.type === "content_block_delta" && p.delta?.type === "text_delta") {
      yield { type: "text", text: p.delta.text };
    } else if (p.type === "message_delta" && (p.usage || p.delta?.stop_reason)) {
      const sr = p.delta?.stop_reason;
      yield { type: "usage", usage: { inputTokens: input, cachedInputTokens: cached, cacheWriteInputTokens: cacheWrite, outputTokens: p.usage?.output_tokens ?? null, requestId, stopReason: sr ? (sr === "end_turn" || sr === "stop_sequence" ? "complete" : String(sr)) : null } };
    } else if (p.type === "error") {
      throw new AIProviderError("unavailable", `${provider}: ${scrubSecrets(String(p.error?.message ?? "stream error"), ctx.apiKey)}`);
    }
  }
}

// ── Adapters ──
const GATEWAY = "https://ai.gateway.lovable.dev/v1";

export const lovableGatewayAdapter: ProviderAdapter = {
  id: "lovable_gateway",
  stream(req, ctx) {
    const id = ctx.model.gatewayId;
    if (!id) throw new AIProviderError("unavailable", `${ctx.model.displayName} is not available through built-in AI`);
    const headers: Record<string, string> = { Authorization: `Bearer ${ctx.apiKey}`, "Lovable-API-Key": ctx.apiKey, "X-Lovable-AIG-SDK": "fetch" };
    if (ctx.runId) headers["X-Lovable-AIG-Run-ID"] = ctx.runId;
    if (ctx.model.provider === "openai") return responses(`${GATEWAY}/responses`, headers, id, req, ctx, "lovable_gateway");
    if (ctx.model.provider === "anthropic") return messages(`${GATEWAY}/messages`, headers, id, req, ctx, "lovable_gateway");
    return chatCompletions(`${GATEWAY}/chat/completions`, headers, id, req, ctx, "lovable_gateway");
  },
};

export const openaiAdapter: ProviderAdapter = {
  id: "openai",
  stream: (req, ctx) => responses("https://api.openai.com/v1/responses", { Authorization: `Bearer ${ctx.apiKey}` }, ctx.model.directId, req, ctx, "OpenAI"),
};

export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  stream: (req, ctx) => messages("https://api.anthropic.com/v1/messages", { "x-api-key": ctx.apiKey, "anthropic-beta": "prompt-caching-2024-07-31" }, ctx.model.directId, req, ctx, "Anthropic"),
};

/** DeepSeek: automatic prefix caching — callers keep the static system prompt first. */
export const deepseekAdapter: ProviderAdapter = {
  id: "deepseek",
  stream: (req, ctx) => chatCompletions("https://api.deepseek.com/chat/completions", { Authorization: `Bearer ${ctx.apiKey}` }, ctx.model.directId, req, ctx, "DeepSeek", req.thinking == null ? {} : { thinking: { type: req.thinking ? "enabled" : "disabled" } }),
};

export const geminiAdapter: ProviderAdapter = {
  id: "gemini",
  stream: (req, ctx) => chatCompletions("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", { Authorization: `Bearer ${ctx.apiKey}` }, ctx.model.directId, req, ctx, "Google Gemini"),
};

export const ADAPTERS: Record<AdapterId, ProviderAdapter> = {
  lovable_gateway: lovableGatewayAdapter,
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  deepseek: deepseekAdapter,
  gemini: geminiAdapter,
};

export function getAdapter(id: AdapterId): ProviderAdapter {
  return ADAPTERS[id];
}
