// Pass 4 — Continuity check + bounded automated revision for ONE saved section.
// Reads the saved section text (never client prose), compares it to narrative state
// strictly before the section, revises repairable errors (≤3 cycles), saves the final
// text back, and records an append-only continuity_checks row. Narrative extraction
// runs AFTER this (client-sequenced), so candidate drafts never reach story state.
import { findDeprecatedUses, parseReplacements } from "../_shared/narrative/deprecations.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { generateAIText } from "../_shared/ai/client.ts";
import { createAIDeps, loadBookModelConfig } from "../_shared/ai/server.ts";
import { loadNarrativeRows, verifyBookOwnership } from "../_shared/narrative/supabaseRepo.ts";
import { renderNarrativeContext, selectNarrativeState } from "../_shared/narrative/context.ts";
import { contentHash } from "../_shared/narrative/extraction.ts";
import {
  buildCheckerPrompt, buildRevisionPrompt, isNonfiction, maxSeverity, parseCheckerOutput, resolutionFor, runContinuityLoop,
  type ContinuityIssue,
} from "../_shared/narrative/continuity.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINAL = ["PASSED", "PASSED_WITH_WARNINGS", "REVISED", "NEEDS_REVIEW"];

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

    const raw = await req.text();
    if (raw.length > 2000) return json({ error: "Payload too large" }, 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON" }, 400); }
    const { bookId, chapterIndex, subsectionIndex } = body as { bookId: unknown; chapterIndex: unknown; subsectionIndex: unknown };
    if (typeof bookId !== "string" || !UUID.test(bookId)) return json({ error: "Invalid bookId" }, 400);
    if (!Number.isInteger(chapterIndex) || (chapterIndex as number) < 0 || (chapterIndex as number) > 999) return json({ error: "Invalid chapterIndex" }, 400);
    if (!Number.isInteger(subsectionIndex) || (subsectionIndex as number) < 0 || (subsectionIndex as number) > 999) return json({ error: "Invalid subsectionIndex" }, 400);
    const ch = chapterIndex as number, sub = subsectionIndex as number;

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const owned = await verifyBookOwnership(db, bookId, userId);
    if (!owned) return json({ error: "Book not found" }, 404);

    const { data: allowed } = await db.rpc("check_rate_limit", { _user_id: userId, _function_name: "check-continuity", _max_per_hour: 300, _max_per_day: 3000 });
    if (allowed === false) return json({ error: "Rate limit exceeded" }, 429);

    const { data: bookRow } = await db.from("books").select("outline, book_type, full_text").eq("id", bookId).maybeSingle();
    const section = bookRow?.outline?.chapters?.[ch]?.subsections?.[sub];
    if (!section || section.status !== "completed" || typeof section.content !== "string" || !section.content.trim()) {
      return json({ status: "no_prose" }, 409);
    }
    const original: string = section.content;
    const hash = contentHash(original);

    // Idempotency: this exact text was already checked (as original or as a revision result).
    const { data: prior } = await db.from("continuity_checks").select("id, status, final_text, issues, warnings, revision_count")
      .eq("book_id", bookId).eq("chapter_index", ch).eq("subsection_index", sub)
      .or(`original_hash.eq.${hash},final_hash.eq.${hash}`).in("status", FINAL).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (prior) {
      return json({ status: prior.status, checkId: prior.id, cached: true, revised: false, finalText: original,
        issueCount: (prior.issues as unknown[]).length, warningCount: (prior.warnings as unknown[]).length });
    }

    const { data: rec, error: insErr } = await db.from("continuity_checks").insert({
      book_id: bookId, user_id: userId, chapter_index: ch, subsection_index: sub, subsection_id: section.id ?? null,
      original_hash: hash, status: "PROCESSING", original_text: original,
    }).select("id").single();
    if (insErr) throw new Error(insErr.message);

    // Relevant structured state only (bounded by context LIMITS) — never the whole manuscript.
    const rows = await loadNarrativeRows(db, bookId);
    const stateText = renderNarrativeContext(selectNarrativeState(rows, { chapterIndex: ch, subsectionIndex: sub }, owned.outline?.characters ?? []));
    const nonfiction = isNonfiction(bookRow?.book_type);
    // Deterministic guard: replaced APIs/terms established before this section must not reappear.
    const replacements = parseReplacements(rows.entities.filter((e) => typeof e.first_chapter_index === "number" && (e.first_chapter_index < ch || (e.first_chapter_index === ch && (e.first_subsection_index ?? 0) < sub))));
    const config = await loadBookModelConfig(db, bookId, userId);
    const deps = createAIDeps(db, userId);
    const models = new Set<string>();

    const result = await runContinuityLoop(original, {
      async check(text) {
        const p = buildCheckerPrompt({ stateText, sectionText: text, nonfiction, chapterNumber: ch + 1, subsectionNumber: sub + 1 });
        const { text: out, meta } = await generateAIText({ role: "continuity_checker", config, userId, bookId, request: { ...p, json: true, temperature: 0, reasoning: "low" } }, deps);
        models.add(meta.model);
        return [...parseCheckerOutput(out, text).issues, ...findDeprecatedUses(text, replacements)];
      },
      async revise(text, targets: ContinuityIssue[]) {
        const p = buildRevisionPrompt({ sectionText: text, issues: targets, stateText, nonfiction });
        const { text: out, meta } = await generateAIText({ role: "continuity_reviser", config, userId, bookId, request: { ...p, temperature: 0.3, reasoning: "low" } }, deps);
        models.add(meta.model);
        return out;
      },
    });

    const finalHash = contentHash(result.finalText);
    // Persist the final text only when it actually changed. Re-read to avoid clobbering concurrent edits.
    if (result.revised && result.finalText !== original) {
      const { data: fresh } = await db.from("books").select("outline, full_text").eq("id", bookId).maybeSingle();
      const target = fresh?.outline?.chapters?.[ch]?.subsections?.[sub];
      if (target && target.content === original) {
        target.content = result.finalText;
        const ft: string = fresh.full_text ?? "";
        const idx = ft.lastIndexOf(original);
        const update: Record<string, unknown> = { outline: fresh.outline };
        if (idx >= 0) {
          const nextFt = ft.slice(0, idx) + result.finalText + ft.slice(idx + original.length);
          update.full_text = nextFt; update.total_char_count = nextFt.length;
        }
        const { error } = await db.from("books").update(update).eq("id", bookId).eq("user_id", userId);
        if (error) console.warn("[check-continuity] save revised text failed:", error.message);
      }
    }

    const all = [...result.issues, ...result.warnings];
    await db.from("continuity_checks").update({
      status: result.status, final_hash: finalHash, final_text: result.finalText,
      max_severity: maxSeverity(all), confidence: all.length ? Math.max(...all.map((i) => i.confidence)) : null,
      issues: result.issues, warnings: result.warnings, attempts: result.attempts, revision_count: result.revisionCount,
      resolution_status: resolutionFor(result.status), model_identifier: [...models].join(",") || null, error: result.error,
    }).eq("id", rec.id);

    console.log("[check-continuity]", JSON.stringify({ bookId, ch, sub, status: result.status, revisions: result.revisionCount, issues: result.issues.length, warnings: result.warnings.length }));
    return json({
      status: result.status, checkId: rec.id, revised: result.revised, finalText: result.finalText,
      issueCount: result.issues.length, warningCount: result.warnings.length, revisionCount: result.revisionCount,
    });
  } catch (e) {
    console.error("[check-continuity] fatal", e);
    return json({ status: "CHECK_FAILED", error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
