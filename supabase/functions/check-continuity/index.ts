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
import { buildAnchorRepairPrompt, discrepanciesFor, LEASE_TTL_SECONDS, resolvePipeline, runAnchorRepair } from "../_shared/narrative/planning/pipeline.ts";
import { loadProgressiveState } from "../_shared/narrative/planning/pipelineRepo.ts";
import { decideRevision } from "../_shared/narrative/planning/validation.ts";
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
  // Fail-closed: no free stand-in here, so test mode must never reach a paid model.
  if (req.headers.get("x-ai-test-mode") === "1") {
    return new Response(JSON.stringify({ error: "test_mode_blocked" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
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

    const { data: bookRow } = await db.from("books").select("outline, book_type, full_text, controls").eq("id", bookId).maybeSingle();
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
    const stateText = renderNarrativeContext(selectNarrativeState(rows, { chapterIndex: ch, subsectionIndex: sub }, owned.outline?.characters ?? [], owned.outline?.chapters ?? []));
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

    // ── Phase F (opt-in books only): exact-detail enforcement + serious contradictions to the author. ──
    let anchorReport: Record<string, unknown> | null = null;
    if (resolvePipeline(bookRow?.controls) === "progressive") {
      try {
        const st = await loadProgressiveState(db, bookId, userId, bookRow?.book_type ?? "", bookRow?.outline ?? null, ch, sub);
        const fix = await runAnchorRepair(result.finalText, st.anchors, st.required, async (t, v) => {
          const p = buildAnchorRepairPrompt(t, v);
          const { text: out, meta } = await generateAIText({ role: "continuity_reviser", config, userId, bookId, request: { ...p, temperature: 0.2, reasoning: "low" } }, deps);
          models.add(meta.model); return out;
        });
        if (fix.repaired) { result.finalText = fix.text; result.revised = true; }
        anchorReport = { required: st.required.length, repaired: fix.repaired, attempts: fix.attempts, remaining: fix.remaining.map((v) => v.key) };
        const hash2 = contentHash(result.finalText);
        for (const d of discrepanciesFor(result.issues as never, fix.remaining)) {
          const { error } = await db.rpc("record_canon_discrepancy", { p_book_id: bookId, p_user_id: userId, p_chapter: ch, p_sub: sub, p_severity: d.severity, p_type: d.type,
            p_description: d.description, p_excerpt: d.excerpt, p_canon_ref: d.canonRef, p_content_hash: hash2, p_dedup_key: `pf_${bookId}_${ch}_${sub}_${hash2.slice(0, 16)}_${d.dedupSuffix}`.slice(0, 400) });
          if (error) console.warn("[phase-f] discrepancy record failed:", error.message);
        }
      } catch (e) { console.warn("[phase-f] anchor/contradiction step skipped:", e instanceof Error ? e.message : e); }
    }

    const progressiveBook = resolvePipeline(bookRow?.controls) === "progressive";
    // Phase G: automatic repairs never overwrite prose already in story memory, and broad
    // rewrites above the book's warning ratio wait for explicit author approval.
    if (progressiveBook && result.revised && result.finalText !== original) {
      const { data: acc } = await db.from("book_section_acceptances").select("extraction_status").eq("book_id", bookId).eq("chapter_index", ch).eq("subsection_index", sub).maybeSingle();
      const warnRatio = Number((bookRow?.controls as Record<string, unknown> | null)?.revisionWarnRatio) || undefined;
      const d = decideRevision({ original, revised: result.finalText, draftInCanon: acc?.extraction_status === "EXTRACTED", warnRatio });
      if (!d.apply) {
        const h = contentHash(original);
        await db.from("editorial_validation_findings").upsert({ book_id: bookId, user_id: userId, chapter_index: ch, subsection_index: sub, content_hash: h,
          code: d.reason.toUpperCase(), category: "continuity", severity: "moderate", route: d.route === "author_approval" ? "author_approval" : "editorial_review",
          message: d.route === "author_approval" ? `Suggested correction changes ${Math.round(d.ratio * 100)}% of paragraphs; needs your approval.` : "Suggested correction was not applied automatically.",
          details: { proposed_text: result.finalText, ratio: d.ratio }, dedup_key: `pgr_${bookId}_${ch}_${sub}_${h.slice(0, 16)}_${d.reason}`.slice(0, 400) }, { onConflict: "dedup_key", ignoreDuplicates: true });
        result.finalText = original; result.revised = false;
      }
    }
    const finalHash = contentHash(result.finalText);
    // Progressive books: the revised text is a protected write — lease + fence in one transaction.
    if (progressiveBook && result.revised && result.finalText !== original) {
      const worker = `cc_${crypto.randomUUID()}`;
      const { data: acq } = await db.rpc("acquire_generation_lease", { p_book_id: bookId, p_user_id: userId, p_chapter: ch, p_sub: sub, p_worker: worker, p_ttl_seconds: LEASE_TTL_SECONDS });
      if (!acq?.acquired) console.warn("[phase-f] revision not saved: section is being written elsewhere");
      else {
        const { data: c, error } = await db.rpc("commit_fenced_revision", { p_book_id: bookId, p_user_id: userId, p_chapter: ch, p_sub: sub, p_worker: worker, p_token: Number(acq.fencing_token), p_original: original, p_text: result.finalText, p_hash: finalHash });
        if (error) { console.warn("[phase-f] revision rejected:", error.message); await db.rpc("release_generation_lease", { p_lease_id: acq.lease_id, p_worker: worker, p_token: Number(acq.fencing_token) }).then(() => {}, () => {}); }
        else console.log("[phase-f] revision", JSON.stringify(c));
      }
    } else if (result.revised && result.finalText !== original) {
      // Persist the final text only when it actually changed. Re-read to avoid clobbering concurrent edits.
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
      issueCount: result.issues.length, warningCount: result.warnings.length, revisionCount: result.revisionCount, anchors: anchorReport,
    });
  } catch (e) {
    console.error("[check-continuity] fatal", e);
    return json({ status: "CHECK_FAILED", error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
