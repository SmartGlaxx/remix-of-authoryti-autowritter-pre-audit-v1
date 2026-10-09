// Per-book model configuration: get / save / reset, plus resolved role map and cost estimates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { normalizeConfig, resolveAllRoles } from "../_shared/ai/roles.ts";
import { estimateOperationCosts, estimatePipeline } from "../_shared/ai/estimate.ts";
import { loadPrices } from "../_shared/ai/pricing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// deno-lint-ignore no-explicit-any
function bookLengthWords(book: any): number {
  const target = Number(book.controls?.structureControls?.targetWordCount);
  if (Number.isFinite(target) && target > 0) return target;
  const ch = book.outline?.chapters ?? [];
  // deno-lint-ignore no-explicit-any
  const subs = ch.reduce((n: number, c: any) => n + (c?.subsections?.length ?? 0), 0);
  return Math.max(subs * 600, book.word_count ?? 0, 30000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: claims } = await anon.auth.getClaims(authHeader.slice(7));
    const userId = claims?.claims?.sub as string | undefined;
    if (!userId) return json({ error: "Unauthorized" }, 401);

    const text = await req.text();
    if (text.length > 8000) return json({ error: "Payload too large" }, 413);
    const body = JSON.parse(text || "{}") as Record<string, unknown>;
    const bookId = body.bookId;
    if (typeof bookId !== "string" || !UUID.test(bookId)) return json({ error: "Invalid bookId" }, 400);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: book } = await db.from("books").select("id, outline, controls, word_count").eq("id", bookId).eq("user_id", userId).maybeSingle();
    if (!book) return json({ error: "Book not found" }, 404);

    if (body.action === "save") {
      const c = normalizeConfig(body.config);
      const { error: saveErr } = await db.from("book_model_configs").upsert({ book_id: bookId, user_id: userId, mode: c.mode, single_model: c.singleModel ?? null, profile_writer: c.mode === "profile" ? c.profileWriter : null, profile_tier: c.mode === "profile" ? c.profileTier : null, role_models: c.roleModels ?? {}, fallbacks: c.fallbacks ?? {} }, { onConflict: "book_id" });
      if (saveErr) { console.error("[model-config] save failed:", saveErr.message); return json({ error: "Could not save the writer setup" }, 500); }
    } else if (body.action === "reset") {
      await db.from("book_model_configs").delete().eq("book_id", bookId).eq("user_id", userId);
    }

    const { data: row } = await db.from("book_model_configs").select("mode, single_model, role_models, fallbacks, profile_writer, profile_tier").eq("book_id", bookId).eq("user_id", userId).maybeSingle();
    const config = normalizeConfig(row);
    const { data: keys } = await db.from("user_provider_keys").select("provider").eq("user_id", userId);
    const { prices, fetchedAt, sources } = await loadPrices(db, Deno.env.get("LOVABLE_API_KEY"), body.action === "refresh_prices");
    return json({
      pricesFetchedAt: fetchedAt,
      config,
      saved: !!row,
      resolved: resolveAllRoles(config),
      userKeyProviders: (keys ?? []).map((k) => k.provider),
      estimates: estimateOperationCosts(config, book.outline, prices),
      pricesSources: sources,
      pipeline: estimatePipeline(config, bookLengthWords(book), prices),
    });
  } catch (e) {
    console.error("[model-config]", e instanceof Error ? e.message : e);
    return json({ error: "Request failed" }, 500);
  }
});
