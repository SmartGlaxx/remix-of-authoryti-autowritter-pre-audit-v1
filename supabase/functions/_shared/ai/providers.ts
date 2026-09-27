// Provider adapters. Each adapter owns URL, auth, request shape, stream parsing,
// usage extraction and error normalization. Nothing outside this file knows a provider's wire format.
// Runtime-neutral (no Deno globals) so it runs in edge functions and in tests.
import type { ModelInfo, ProviderId } from "./registry.ts";

export interface AIRequest {
  system?: string;
  user: string;
  json?: boolean;
  temperature?: number;
  reasoning?: "low" | "medium" | "high";
  maxOutputTokens?: number;
}

export interface Usage {
  /** Total input tokens including cached ones; null = provider did not report. */
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  requestId: string | null;
}

export type AIEvent = { type: "text"; text: string } | { type: "usage"; usage: Partial<Usage> };

export type AIErrorCode = "missing_key" | "auth" | "rate_limit" | "payment" | "forbidden" | "bad_request" | "unavailable" | "network" | "inactive_role" | "unknown";

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
  if (s === 404) throw new AIProviderError("unavailable", `${label}: model or endpoint not available`, s);
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
  if (ctx.model.reasoningControls) {
    body.reasoning = { effort: req.reasoning ?? "medium", summary: "auto" };
    body.include = ["reasoning.encrypted_content"];
  }
  if (req.temperature != null && !ctx.model.rejectsSampling) body.temperature = req.temperature;
  if (req.json) body.text = { format: { type: "json_object" } };
  const res = await post(ctx, url, headers, body, provider);
  for await (const { event, data } of sseEvents(res.body!)) {
    if (!data || data === "[DONE]") continue;
    let p: any;
    try { p = JSON.parse(data); } catch { continue; }
    const type = p.type ?? event;
    if (type === "response.output_text.delta" && p.delta) yield { type: "text", text: p.delta };
    else if (type === "response.completed" || type === "response.incomplete") {
      const u = p.response?.usage;
      yield { type: "usage", usage: { inputTokens: u?.input_tokens ?? null, outputTokens: u?.output_tokens ?? null, cachedInputTokens: u?.input_tokens_details?.cached_tokens ?? null, requestId: p.response?.id ?? null } };
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
  if (req.system) body.system = req.system;
  if (req.temperature != null && !ctx.model.rejectsSampling) body.temperature = req.temperature;
  const res = await post(ctx, url, { "anthropic-version": "2023-06-01", ...headers }, body, provider);
  let input: number | null = null, cached: number | null = null, requestId: string | null = null;
  for await (const { data } of sseEvents(res.body!)) {
    if (!data) continue;
    let p: any;
    try { p = JSON.parse(data); } catch { continue; }
    if (p.type === "message_start") {
      const u = p.message?.usage ?? {};
      cached = u.cache_read_input_tokens ?? null;
      input = u.input_tokens != null ? u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : null;
      requestId = p.message?.id ?? null;
    } else if (p.type === "content_block_delta" && p.delta?.type === "text_delta") {
      yield { type: "text", text: p.delta.text };
    } else if (p.type === "message_delta" && p.usage) {
      yield { type: "usage", usage: { inputTokens: input, cachedInputTokens: cached, outputTokens: p.usage.output_tokens ?? null, requestId } };
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
  stream: (req, ctx) => messages("https://api.anthropic.com/v1/messages", { "x-api-key": ctx.apiKey }, ctx.model.directId, req, ctx, "Anthropic"),
};

/** DeepSeek: automatic prefix caching — callers keep the static system prompt first. */
export const deepseekAdapter: ProviderAdapter = {
  id: "deepseek",
  stream: (req, ctx) => chatCompletions("https://api.deepseek.com/chat/completions", { Authorization: `Bearer ${ctx.apiKey}` }, ctx.model.directId, req, ctx, "DeepSeek"),
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
