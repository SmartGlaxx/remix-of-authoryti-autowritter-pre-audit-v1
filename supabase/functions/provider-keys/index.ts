// BYOK key management. Keys are write-only: they are encrypted on arrival and never returned.
// Responses contain only provider, status and a masked hint (e.g. sk-••••••••1234).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { encryptKey, decryptKey } from "../_shared/ai/keyCrypto.ts";
import { AIProviderError, getAdapter, maskKey, scrubSecrets } from "../_shared/ai/providers.ts";
import { requireModel, type ProviderId } from "../_shared/ai/registry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const PROVIDERS: ProviderId[] = ["openai", "anthropic"];
/** Smallest model per provider used only for the connection test. */
const TEST_MODEL: Partial<Record<ProviderId, string>> = {
  openai: "openai/gpt-6-sol",
  anthropic: "anthropic/claude-sonnet-5",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let rawKey: string | undefined;
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error: claimsErr } = await anon.auth.getClaims(authHeader.slice(7));
    const userId = claims?.claims?.sub as string | undefined;
    if (claimsErr || !userId) return json({ error: "Unauthorized" }, 401);

    const text = await req.text();
    if (text.length > 4000) return json({ error: "Payload too large" }, 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(text || "{}"); } catch { return json({ error: "Invalid JSON" }, 400); }
    const action = body.action;
    const provider = body.provider as ProviderId | undefined;
    if (action !== "list" && (!provider || !PROVIDERS.includes(provider))) return json({ error: "Invalid provider" }, 400);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const secret = Deno.env.get("BYOK_ENCRYPTION_KEY") ?? "";

    if (action === "list") {
      const { data } = await db.from("user_provider_keys").select("provider, prefix, last4, status, last_tested_at, updated_at").eq("user_id", userId);
      return json({ keys: (data ?? []).map((r) => ({ provider: r.provider, masked: `${r.prefix ?? ""}••••••••${r.last4}`, status: r.status, lastTestedAt: r.last_tested_at, updatedAt: r.updated_at })) });
    }

    if (action === "save") {
      rawKey = typeof body.key === "string" ? body.key.trim() : "";
      if (rawKey.length < 20 || rawKey.length > 400 || /\s/.test(rawKey)) return json({ error: "That doesn't look like a valid API key" }, 400);
      const { ciphertext, iv } = await encryptKey(secret, userId, rawKey);
      const m = maskKey(rawKey);
      const { error } = await db.from("user_provider_keys").upsert({ user_id: userId, provider, ciphertext, iv, last4: m.last4, prefix: m.prefix, status: "untested", last_tested_at: null }, { onConflict: "user_id,provider" });
      if (error) return json({ error: "Could not save key" }, 500);
      return json({ provider, masked: m.masked, status: "untested" });
    }

    if (action === "delete") {
      await db.from("user_provider_keys").delete().eq("user_id", userId).eq("provider", provider);
      return json({ provider, deleted: true });
    }

    if (action === "test") {
      const { data } = await db.from("user_provider_keys").select("ciphertext, iv").eq("user_id", userId).eq("provider", provider).maybeSingle();
      if (!data) return json({ ok: false, error: "No key saved for this provider" });
      let key: string;
      try { key = await decryptKey(secret, userId, data.ciphertext, data.iv); } catch { return json({ ok: false, error: "Stored key could not be read — please re-enter it" }); }
      rawKey = key;
      let ok = false, errorMsg: string | null = null;
      try {
        const model = requireModel(TEST_MODEL[provider!]);
        const gen = getAdapter(provider!).stream({ user: "Reply with the single word OK.", reasoning: "low", maxOutputTokens: 16 }, { model, apiKey: key, fetch, signal: AbortSignal.timeout(30_000) });
        for await (const ev of gen) { if (ev.type === "text") { ok = true; break; } }
        if (!ok) ok = true; // stream completed without error
      } catch (e) {
        errorMsg = e instanceof AIProviderError ? (e.code === "auth" ? "The provider rejected this key" : e.message) : "Connection failed";
        errorMsg = scrubSecrets(errorMsg, key);
      }
      await db.from("user_provider_keys").update({ status: ok ? "valid" : "invalid", last_tested_at: new Date().toISOString() }).eq("user_id", userId).eq("provider", provider);
      return json({ ok, error: errorMsg });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("[provider-keys]", scrubSecrets(e instanceof Error ? e.message : String(e), rawKey));
    return json({ error: "Request failed" }, 500);
  }
});
