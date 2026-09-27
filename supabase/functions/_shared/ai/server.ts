// Deno wiring for the AI layer: builds AIDeps from the service-role client for ONE caller.
// getUserKey is scoped to the authenticated caller's user id — it can never load another user's key.
// deno-lint-ignore-file no-explicit-any
import type { AIDeps, UsageRecord } from "./client.ts";
import type { ProviderId } from "./registry.ts";
import { normalizeConfig, type BookModelConfig } from "./roles.ts";
import { decryptKey } from "./keyCrypto.ts";

declare const Deno: { env: { get(k: string): string | undefined } };

export function createAIDeps(admin: any, userId: string): AIDeps {
  const cache = new Map<ProviderId, string | null>();
  return {
    env: { LOVABLE_API_KEY: Deno.env.get("LOVABLE_API_KEY"), DEEPSEEK_API_KEY: Deno.env.get("DEEPSEEK_API_KEY") },
    async getUserKey(provider) {
      if (cache.has(provider)) return cache.get(provider)!;
      let key: string | null = null;
      const { data } = await admin.from("user_provider_keys").select("ciphertext, iv").eq("user_id", userId).eq("provider", provider).maybeSingle();
      if (data) {
        try { key = await decryptKey(Deno.env.get("BYOK_ENCRYPTION_KEY") ?? "", userId, data.ciphertext, data.iv); }
        catch { key = null; console.warn(`[ai] stored ${provider} key could not be decrypted`); }
      }
      cache.set(provider, key);
      return key;
    },
    async recordUsage(r: UsageRecord) {
      await admin.from("ai_usage_records").insert({
        user_id: r.userId, book_id: r.bookId, role: r.role, provider: r.provider, model: r.model,
        credential_source: r.credentialSource, input_tokens: r.inputTokens, output_tokens: r.outputTokens,
        cached_input_tokens: r.cachedInputTokens, estimated_cost_usd: r.estimatedCostUsd, success: r.success,
        error_code: r.errorCode, request_id: r.requestId,
      });
    },
    log: (m) => console.log(m),
  };
}

/** Loads a book's model config (owner-scoped). Missing row → legacy default. */
export async function loadBookModelConfig(admin: any, bookId: string | null | undefined, userId: string): Promise<BookModelConfig> {
  if (!bookId) return normalizeConfig(null);
  const { data } = await admin.from("book_model_configs").select("mode, single_model, role_models, fallbacks").eq("book_id", bookId).eq("user_id", userId).maybeSingle();
  return normalizeConfig(data);
}
