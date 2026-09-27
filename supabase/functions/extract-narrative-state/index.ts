// Post-generation story-state extraction. Reads the SAVED section text from the book
// (never trusts client-supplied prose), extracts only what the text establishes, and
// records it in the narrative ledgers. Idempotent per (book, chapter, section, text hash).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { processSectionExtraction, type ModelCaller } from "../_shared/narrative/extraction.ts";
import { generateAIText } from "../_shared/ai/client.ts";
import { createAIDeps, loadBookModelConfig } from "../_shared/ai/server.ts";
import type { BookModelConfig } from "../_shared/ai/roles.ts";
import { createSupabaseNarrativeRepo, verifyBookOwnership } from "../_shared/narrative/supabaseRepo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Extraction model boundary — Pass 3: resolved per book through the provider-neutral AI layer
// (role = narrative_extractor). Nothing else in this function knows about providers.
function makeExtractionCaller(db: ReturnType<typeof createClient>, userId: string, bookId: string, config: BookModelConfig): ModelCaller {
  return async ({ system, user }) => {
    const { text, meta } = await generateAIText({ role: "narrative_extractor", config, userId, bookId, request: { system, user, json: true, temperature: 0, reasoning: "low" } }, createAIDeps(db, userId));
    return { content: text, model: meta.model };
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error: claimsErr } = await anon.auth.getClaims(authHeader.slice(7));
    const userId = claims?.claims?.sub as string | undefined;
    if (claimsErr || !userId) return json({ error: "Unauthorized" }, 401);

    const text = await req.text();
    if (text.length > 2000) return json({ error: "Payload too large" }, 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(text); } catch { return json({ error: "Invalid JSON" }, 400); }
    const { bookId, chapterIndex, subsectionIndex } = body as { bookId: unknown; chapterIndex: unknown; subsectionIndex: unknown };
    if (typeof bookId !== "string" || !UUID.test(bookId)) return json({ error: "Invalid bookId" }, 400);
    if (!Number.isInteger(chapterIndex) || (chapterIndex as number) < 0 || (chapterIndex as number) > 999) return json({ error: "Invalid chapterIndex" }, 400);
    if (!Number.isInteger(subsectionIndex) || (subsectionIndex as number) < 0 || (subsectionIndex as number) > 999) return json({ error: "Invalid subsectionIndex" }, 400);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const owned = await verifyBookOwnership(db, bookId, userId);
    if (!owned) return json({ error: "Book not found" }, 404);

    const { data: allowed } = await db.rpc("check_rate_limit", { _user_id: userId, _function_name: "extract-narrative-state", _max_per_hour: 300, _max_per_day: 3000 });
    if (allowed === false) return json({ error: "Rate limit exceeded" }, 429);

    const repo = createSupabaseNarrativeRepo(db, userId);
    const config = await loadBookModelConfig(db, bookId, userId);
    const outcome = await processSectionExtraction(repo, makeExtractionCaller(db, userId, bookId, config), bookId, { chapterIndex: chapterIndex as number, subsectionIndex: subsectionIndex as number });
    console.log("[extract-narrative-state]", JSON.stringify(outcome));
    // no_prose = section not saved yet → 409 so the client can retry shortly.
    const status = outcome.status === "no_prose" ? 409 : outcome.status === "failed" ? 500 : 200;
    return json(outcome, status);
  } catch (e) {
    console.error("[extract-narrative-state] fatal", e);
    return json({ status: "failed", error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
