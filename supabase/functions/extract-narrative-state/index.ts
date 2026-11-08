// Post-generation story-state extraction. Reads the SAVED section text from the book
// (never trusts client-supplied prose), extracts only what the text establishes, and
// records it in the narrative ledgers. Idempotent per (book, chapter, section, text hash).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { processSectionExtraction, type ModelCaller } from "../_shared/narrative/extraction.ts";
import { generateAIText } from "../_shared/ai/client.ts";
import { createAIDeps, loadBookModelConfig } from "../_shared/ai/server.ts";
import type { BookModelConfig } from "../_shared/ai/roles.ts";
import { syncIdentityForSection } from "../_shared/narrative/identityRepo.ts";
import { createSupabaseNarrativeRepo, verifyBookOwnership } from "../_shared/narrative/supabaseRepo.ts";
import { knowledgeEnabled, syncKnowledgeForSection } from "../_shared/narrative/knowledgeRepo.ts";
import { extractionStatusFor, resolvePipeline } from "../_shared/narrative/planning/pipeline.ts";

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
    const testHeader = req.headers.get("x-ai-test-mode") === "1";
    if (text.length > (testHeader ? 20_000 : 2000)) return json({ error: "Payload too large" }, 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(text); } catch { return json({ error: "Invalid JSON" }, 400); }
    // Fail-closed test mode: the extractor reply is caller-supplied and runs through the real parser, evidence
    // checks and saves; without one the call is refused. No AI key is ever reached.
    const testMode = testHeader || body.testMode === true;
    if (testMode && typeof body.mockOutput !== "string") return json({ error: "test_mode_blocked" }, 403);
    const { bookId, chapterIndex, subsectionIndex } = body as { bookId: unknown; chapterIndex: unknown; subsectionIndex: unknown };
    if (typeof bookId !== "string" || !UUID.test(bookId)) return json({ error: "Invalid bookId" }, 400);
    if (!Number.isInteger(chapterIndex) || (chapterIndex as number) < 0 || (chapterIndex as number) > 999) return json({ error: "Invalid chapterIndex" }, 400);
    if (!Number.isInteger(subsectionIndex) || (subsectionIndex as number) < 0 || (subsectionIndex as number) > 999) return json({ error: "Invalid subsectionIndex" }, 400);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const owned = await verifyBookOwnership(db, bookId, userId);
    if (!owned) return json({ error: "Book not found" }, 404);

    const { data: allowed } = await db.rpc("check_rate_limit", { _user_id: userId, _function_name: "extract-narrative-state", _max_per_hour: 300, _max_per_day: 3000 });
    if (allowed === false) return json({ error: "Rate limit exceeded" }, 429);

    const ch = chapterIndex as number, sub = subsectionIndex as number;
    const { data: ctl } = await db.from("books").select("controls, universe_id, narrator_identity_id").eq("id", bookId).maybeSingle();
    const progressiveBook = resolvePipeline(ctl?.controls) === "progressive";
    // Phase F staged acceptance: accepted prose is never touched here. Memory sync is recorded as
    // EXTRACTED or FAILED; anything else leaves it PENDING, which keeps blocking the next section.
    const markSync = async (st: "EXTRACTED" | "FAILED" | null, err?: unknown) => {
      if (!progressiveBook || !st) return;
      try {
        await db.rpc("mark_section_extraction", { p_book_id: bookId, p_user_id: userId, p_chapter: ch, p_sub: sub, p_status: st, p_error: st === "FAILED" ? String(err ?? "").slice(0, 500) : null });
        // Author-approved canon changes become authoritative only once the accepted prose is in story memory.
        if (st === "EXTRACTED") await db.rpc("finalize_canon_application", { p_book_id: bookId, p_user_id: userId, p_chapter: ch, p_sub: sub });
      } catch (e) { console.warn("[phase-f] acceptance update skipped:", e instanceof Error ? e.message : e); }
    };

    const trackKnowledge = knowledgeEnabled(ctl as never);
    let outcome: Awaited<ReturnType<typeof processSectionExtraction>>;
    try {
      const repo = createSupabaseNarrativeRepo(db, userId);
      const config = await loadBookModelConfig(db, bookId, userId);
      const caller: ModelCaller = testMode ? async () => ({ content: String(body.mockOutput), model: "test-mock" }) : makeExtractionCaller(db, userId, bookId, config);
      outcome = await processSectionExtraction(repo, caller, bookId, { chapterIndex: ch, subsectionIndex: sub }, { knowledge: trackKnowledge, paragraphMemory: true });
    } catch (e) {
      await markSync("FAILED", e instanceof Error ? e.message : e);
      throw e;
    }
    console.log("[extract-narrative-state]", JSON.stringify(outcome));
    // Phase 2D: only accepted, freshly extracted text feeds the identity registry. Never fails the extraction.
    if (outcome.status === "completed") {
      try {
        const identity = await syncIdentityForSection(db, bookId, userId, { chapterIndex: ch, subsectionIndex: sub });
        (outcome as Record<string, unknown>).identity = identity;
        console.log("[identity-sync]", JSON.stringify(identity));
      } catch (e) { console.warn("[identity-sync] skipped:", e instanceof Error ? e.message : e); }
      // Phase 3: character knowledge from accepted text only; never fails the extraction.
      if (trackKnowledge && outcome.knowledge) {
        try {
          const k = await syncKnowledgeForSection(db, { bookId, userId, universeId: (ctl as any)?.universe_id ?? null, pos: { chapterIndex: ch, subsectionIndex: sub },
            extractionId: outcome.extractionId, contentHash: outcome.contentHash!, items: outcome.knowledge, sectionDate: outcome.sectionDate, nonLinear: outcome.nonLinear });
          (outcome as Record<string, unknown>).knowledgeSync = k;
          delete (outcome as Record<string, unknown>).knowledge;
        } catch (e) { console.warn("[knowledge-sync] skipped:", e instanceof Error ? e.message : e); }
      }
    }
    await markSync(extractionStatusFor(outcome as never), (outcome as any).error);
    // no_prose = section not saved yet → 409 so the client can retry shortly.
    const denied = outcome.status === "failed" && /credit_limit_reached|denied access/i.test(String((outcome as any).error ?? ""));
    const status = outcome.status === "no_prose" ? 409 : denied ? 403 : outcome.status === "failed" ? 500 : 200;
    return json(outcome, status);
  } catch (e) {
    console.error("[extract-narrative-state] fatal", e);
    return json({ status: "failed", error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
