// runAI — the single entry point for every AI text operation.
// Resolves role → model, picks the credential (user key first, then platform), calls the adapter,
// retries only transient failures, applies ONLY explicitly configured fallbacks, and records usage.
import { ACTIVE_ROLES, estimateCostUSD, requireModel, type ProviderId, type Role } from "./registry.ts";
import { resolveModelForRole, type BookModelConfig } from "./roles.ts";
import { AIProviderError, getAdapter, scrubSecrets, type AdapterId, type AIRequest, type Usage } from "./providers.ts";

export type CredentialSource = "user_key" | "platform" | "platform_gateway";

export interface UsageRecord {
  userId: string;
  bookId: string | null;
  role: Role;
  provider: string;
  model: string;
  credentialSource: CredentialSource;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  estimatedCostUsd: number | null;
  success: boolean;
  errorCode: string | null;
  requestId: string | null;
}

export interface AIDeps {
  env: { LOVABLE_API_KEY?: string; DEEPSEEK_API_KEY?: string };
  /** Decrypted user key for a provider, or null. Must only ever return the CALLER's key. */
  getUserKey(provider: ProviderId): Promise<string | null>;
  recordUsage(rec: UsageRecord): Promise<void>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

export interface RunAIOptions {
  role: Role;
  config: BookModelConfig | null | undefined;
  userId: string;
  bookId?: string | null;
  request: AIRequest;
  /** Force a specific model for this call (e.g. the pre-Pass-3 browser picker). */
  modelOverride?: string | null;
  signal?: AbortSignal;
  maxRetries?: number;
  /** Only the caller's own provider key may be used (no platform/gateway route, no surprise billing). */
  requireUserKey?: boolean;
  /** Book type, so routing can follow book-type rules (e.g. fiction planning on Sonnet 5). */
  bookType?: string | null;
}

export interface RunAIMeta {
  model: string;
  provider: string;
  credentialSource: CredentialSource;
  usedFallback: boolean;
  usage: Usage;
}

interface Route { adapter: AdapterId; apiKey: string; source: CredentialSource }

export async function selectRoute(modelKey: string, deps: AIDeps, requireUserKey = false): Promise<Route> {
  const m = requireModel(modelKey);
  const userKey = await deps.getUserKey(m.provider);
  if (userKey) return { adapter: m.provider, apiKey: userKey, source: "user_key" };
  if (requireUserKey) throw new AIProviderError("missing_key", `${m.displayName} requires your own ${m.provider} key; no substitute route is used.`);
  if (m.provider === "deepseek") {
    if (deps.env.DEEPSEEK_API_KEY) return { adapter: "deepseek", apiKey: deps.env.DEEPSEEK_API_KEY, source: "platform" };
    throw new AIProviderError("missing_key", `No DeepSeek key is configured for ${m.displayName}. Add your DeepSeek key in API Keys.`);
  }
  if (!m.gatewayId) throw new AIProviderError("missing_key", `${m.displayName} needs your own ${m.provider} key.`);
  if (!deps.env.LOVABLE_API_KEY) throw new AIProviderError("missing_key", "Built-in AI is not configured.");
  return { adapter: "lovable_gateway", apiKey: deps.env.LOVABLE_API_KEY, source: "platform_gateway" };
}

/**
 * Fail-closed test mode: no key (user BYOK, platform or gateway) is ever reachable, so any call that
 * was not answered by a mock throws `test_mode_blocked` instead of reaching a paid provider.
 */
export const TEST_MODE_ERROR = "test_mode_blocked";
export function failClosedDeps(deps: AIDeps): AIDeps {
  const block = async (): Promise<never> => { throw new AIProviderError("test_mode_blocked", "Test mode: real AI calls are blocked."); };
  return { ...deps, env: {}, getUserKey: block, fetch: (async () => block()) as typeof fetch };
}

const FALLBACK_ON = new Set(["missing_key", "auth", "unavailable", "network", "rate_limit"]);
const emptyUsage = (): Usage => ({ inputTokens: null, outputTokens: null, cachedInputTokens: null, requestId: null });

/** Streams text chunks. `meta` is filled as the call progresses; usage is recorded when the stream ends. */
export async function* streamAI(opts: RunAIOptions, deps: AIDeps, meta: Partial<RunAIMeta> = {}): AsyncGenerator<string> {
  if (!ACTIVE_ROLES.includes(opts.role)) throw new AIProviderError("inactive_role", `The ${opts.role} role is not active yet.`);
  const resolved = resolveModelForRole(opts.config, opts.role, { bookType: opts.bookType });
  const primary = opts.modelOverride && opts.modelOverride !== resolved.model ? opts.modelOverride : resolved.model;
  const candidates = [primary, ...(resolved.fallback && resolved.fallback !== primary ? [resolved.fallback] : [])];
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxRetries = opts.maxRetries ?? 2;
  let lastErr: unknown = null;

  for (let ci = 0; ci < candidates.length; ci++) {
    const modelKey = candidates[ci];
    const model = requireModel(modelKey);
    let route: Route | null = null;
    const usage = emptyUsage();
    let emitted = false;
    try {
      route = await selectRoute(modelKey, deps, opts.requireUserKey === true);
      Object.assign(meta, { model: modelKey, provider: route.adapter, credentialSource: route.source, usedFallback: ci > 0, usage });
      for (let attempt = 0; ; attempt++) {
        try {
          let req = resolved.reasoning && opts.request.reasoning == null ? { ...opts.request, reasoning: resolved.reasoning } : opts.request;
          if (resolved.thinking != null && req.thinking == null && modelKey === resolved.model) req = { ...req, thinking: resolved.thinking };
          const gen = getAdapter(route.adapter).stream(req, { model, apiKey: route.apiKey, fetch: deps.fetch ?? fetch, signal: opts.signal });
          for await (const ev of gen) {
            if (ev.type === "text") { emitted = true; yield ev.text; }
            else for (const [k, v] of Object.entries(ev.usage)) if (v != null) (usage as any)[k] = v;
          }
          break;
        } catch (e) {
          if (!emitted && e instanceof AIProviderError && e.retryable && attempt < maxRetries) {
            await sleep(1000 * 3 ** attempt + Math.floor(Math.random() * 250));
            continue;
          }
          throw e;
        }
      }
      await safeRecord(deps, opts, modelKey, route, usage, true, null);
      return;
    } catch (e) {
      const err = e instanceof AIProviderError ? e : new AIProviderError("unknown", scrubSecrets(e instanceof Error ? e.message : String(e), route?.apiKey));
      if (route) await safeRecord(deps, opts, modelKey, route, usage, false, err.code);
      lastErr = err;
      deps.log?.(`[ai] ${opts.role} ${modelKey} failed: ${err.code} ${err.message}`);
      // Never fall back after text has reached the user, and only to an explicit fallback.
      if (emitted || !FALLBACK_ON.has(err.code) || ci === candidates.length - 1) throw err;
    }
  }
  throw lastErr ?? new AIProviderError("unknown", "AI call failed");
}

async function safeRecord(deps: AIDeps, opts: RunAIOptions, modelKey: string, route: Route, usage: Usage, success: boolean, errorCode: string | null) {
  try {
    await deps.recordUsage({
      userId: opts.userId,
      bookId: opts.bookId ?? null,
      role: opts.role,
      provider: route.adapter,
      model: modelKey,
      credentialSource: route.source,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      estimatedCostUsd: success ? estimateCostUSD(modelKey, usage) : null,
      success,
      errorCode,
      requestId: usage.requestId,
    });
  } catch (e) {
    deps.log?.(`[ai] usage record failed: ${e instanceof Error ? e.message : e}`);
  }
}

/** Buffers a streamed call into text (streaming underneath avoids long buffered requests). */
export async function generateAIText(opts: RunAIOptions, deps: AIDeps): Promise<{ text: string; meta: RunAIMeta }> {
  const meta: Partial<RunAIMeta> = {};
  let text = "";
  for await (const chunk of streamAI(opts, deps, meta)) text += chunk;
  return { text, meta: meta as RunAIMeta };
}

/** Re-emits text as OpenAI-style chat SSE so existing clients keep working unchanged. */
export function toChatSSE(chunks: AsyncGenerator<string>, onDone?: (full: string) => void | Promise<void>, onError?: (e: unknown) => void): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let full = "";
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await chunks.next();
        if (done) {
          controller.enqueue(enc.encode("data: [DONE]\n\n"));
          controller.close();
          await onDone?.(full);
          return;
        }
        full += value;
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: value } }] })}\n\n`));
      } catch (e) {
        onError?.(e);
        const msg = e instanceof AIProviderError ? e.message : "AI stream failed";
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
        controller.close();
      }
    },
  });
}

/** HTTP status for a controlled AI error. */
export function statusForAIError(e: unknown): number {
  if (!(e instanceof AIProviderError)) return 500;
  return ({ missing_key: 424, auth: 424, rate_limit: 429, payment: 402, forbidden: 403, bad_request: 400, unavailable: 503, network: 503, inactive_role: 400, test_mode_blocked: 403, content_filter: 422, unknown: 500 } as const)[e.code];
}
