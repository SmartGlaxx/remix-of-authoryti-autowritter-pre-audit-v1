// Pass 5 — Manuscript-level audit. AUDIT-ONLY: reads the saved manuscript + story memory,
// writes only manuscript_audits / manuscript_audit_findings. Never touches prose, canon,
// plot threads or chapters. Returns immediately; stages run in the background and the
// client polls the audit row for live stage progress.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { generateAIText } from "../_shared/ai/client.ts";
import { createAIDeps, loadBookModelConfig } from "../_shared/ai/server.ts";
import { loadNarrativeRows, verifyBookOwnership } from "../_shared/narrative/supabaseRepo.ts";
import { renderNarrativeContext, selectNarrativeState } from "../_shared/narrative/context.ts";
import {
  applyConsolidation, buildAuditPrompt, buildConsolidationPrompt, buildEvidenceIndex, buildManuscriptSections, canonicalFactFindings, computeAuditInputs, continuityHistoryFindings,
  deduplicateFindings, initialStageProgress, isNonfiction, LLM_STAGES, manuscriptText, parseStageOutput, plotThreadFindings,
  redundancyFindings, rhetoricalRepetitionFindings, renderIdCatalog, renderManuscriptDigest, renderOutlineText, STAGE_CATEGORY, structuralGapFindings,
  summarizeFindings, toFindingRow, validateFinding, type AuditStage, type RawFinding, type StageProgress, type ValidatedFinding,
} from "../_shared/narrative/audit.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const now = () => new Date().toISOString();

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
    if (raw.length > 1000) return json({ error: "Payload too large" }, 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON" }, 400); }
    const bookId = body.bookId;
    const force = body.forceReaudit === true;
    if (typeof bookId !== "string" || !UUID.test(bookId)) return json({ error: "Invalid bookId" }, 400);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const owned = await verifyBookOwnership(db, bookId, userId);
    if (!owned) return json({ error: "Book not found" }, 404);

    const { data: bookRow } = await db.from("books").select("outline, book_type").eq("id", bookId).maybeSingle();
    const sections = buildManuscriptSections(bookRow?.outline);
    const manuscript = manuscriptText(sections);
    if (!manuscript.trim()) return json({ error: "Nothing written yet" }, 409);

    const [rows, checksRes] = await Promise.all([
      loadNarrativeRows(db, bookId),
      db.from("continuity_checks").select("id, chapter_index, subsection_index, status, resolution_status, max_severity, confidence, issues, error, created_at").eq("book_id", bookId).limit(5000),
    ]);
    const checks = checksRes.data ?? [];
    const inputs = await computeAuditInputs({ manuscript, outline: bookRow?.outline, rows, continuityChecks: checks });

    // Cache: reuse only when manuscript, outline AND narrative state are all unchanged.
    if (!force) {
      const { data: hit } = await db.from("manuscript_audits").select("id, status").eq("book_id", bookId).eq("cache_key", inputs.cache_key)
        .in("status", ["COMPLETE", "RUNNING"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (hit) return json({ auditId: hit.id, status: hit.status, cached: true });
    }
    const { data: running } = await db.from("manuscript_audits").select("id").eq("book_id", bookId).eq("status", "RUNNING")
      .gt("created_at", new Date(Date.now() - 10 * 60_000).toISOString()).limit(1).maybeSingle();
    if (running) return json({ auditId: running.id, status: "RUNNING", cached: true });

    const { data: allowed } = await db.rpc("check_rate_limit", { _user_id: userId, _function_name: "run-manuscript-audit", _max_per_hour: 10, _max_per_day: 40 });
    if (allowed === false) return json({ error: "Rate limit exceeded" }, 429);

    const progress = initialStageProgress(bookRow?.book_type);
    const { data: audit, error: insErr } = await db.from("manuscript_audits").insert({
      book_id: bookId, user_id: userId, ...inputs, status: "RUNNING", stage_progress: progress,
      word_count: sections.reduce((n, s) => n + s.words, 0),
      chapter_count: new Set(sections.map((s) => s.chapterIndex)).size, section_count: sections.filter((s) => s.content.trim()).length,
    }).select("id").single();
    if (insErr) throw new Error(insErr.message);

    const work = runAudit({ db, auditId: audit.id, bookId, userId, bookType: bookRow?.book_type, outline: bookRow?.outline, sections, rows, checks, progress });
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work); else await work;
    return json({ auditId: audit.id, status: "RUNNING", cached: false }, 202);
  } catch (e) {
    console.error("[run-manuscript-audit] fatal", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function runAudit(ctx: { db: any; auditId: string; bookId: string; userId: string; bookType: string; outline: any; sections: ReturnType<typeof buildManuscriptSections>; rows: Awaited<ReturnType<typeof loadNarrativeRows>>; checks: any[]; progress: Record<AuditStage, StageProgress> }) {
  const { db, auditId, bookId, userId, sections, rows, checks, progress } = ctx;
  const save = () => db.from("manuscript_audits").update({ stage_progress: progress }).eq("id", auditId);
  const start = async (s: AuditStage) => { progress[s] = { ...progress[s], status: "running", started_at: now() }; await save(); };
  const done = async (s: AuditStage, count: number, error: string | null = null) => {
    progress[s] = { ...progress[s], status: error ? "failed" : "completed", completed_at: now(), finding_count: count, error }; await save();
  };
  const models = new Set<string>();
  try {
    const nonfiction = isNonfiction(ctx.bookType);
    const bookComplete = sections.length > 0 && sections.every((s) => s.content.trim());
    const config = await loadBookModelConfig(db, bookId, userId);
    const deps = createAIDeps(db, userId);
    const last = [...sections].reverse().find((s) => s.content.trim())!;
    const stateText = renderNarrativeContext(selectNarrativeState(rows, { chapterIndex: last.chapterIndex, subsectionIndex: last.subsectionIndex + 1 }, ctx.outline?.characters ?? [], ctx.outline?.chapters ?? []));
    const digest = renderManuscriptDigest(sections);
    const outlineText = renderOutlineText(sections);
    const idCatalog = renderIdCatalog(rows, checks);

    const deterministic: Partial<Record<AuditStage, () => RawFinding[]>> = {
      plot_threads: () => plotThreadFindings(rows, bookComplete),
      canonical_facts: () => canonicalFactFindings(rows),
      continuity_history: () => continuityHistoryFindings(checks, sections),
      redundancy: () => [...redundancyFindings(sections), ...rhetoricalRepetitionFindings(sections)],
    };

    const stageList = (Object.keys(progress) as AuditStage[]).filter((s) => progress[s].status === "pending" && s !== "evidence_validation" && s !== "deduplication");
    const results = await Promise.allSettled(stageList.map(async (stage) => {
      await start(stage);
      try {
        let found: RawFinding[] = deterministic[stage]?.() ?? [];
        if (LLM_STAGES.includes(stage)) {
          const p = buildAuditPrompt(stage, { digest, stateText, outlineText, nonfiction, idCatalog });
          const { text, meta } = await generateAIText({ role: "manuscript_auditor", config, userId, bookId, request: { ...p, json: true, temperature: 0, reasoning: "medium" } }, deps);
          models.add(meta.model);
          found = [...found, ...parseStageOutput(text, STAGE_CATEGORY[stage]!)];
          if (stage === "structural") found = [...found, ...structuralGapFindings(sections)];
        }
        await done(stage, found.length);
        return found;
      } catch (e) {
        await done(stage, 0, e instanceof Error ? e.message.slice(0, 300) : "failed");
        throw e;
      }
    }));
    const raw = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    const anyFailed = results.some((r) => r.status === "rejected");

    await start("evidence_validation");
    const idx = buildEvidenceIndex(rows, checks);
    const rejected: Record<string, number> = {};
    const valid: ValidatedFinding[] = [];
    for (const f of raw) {
      const v = validateFinding(f, sections, idx);
      if (v.ok) valid.push(v.finding); else rejected[v.reason] = (rejected[v.reason] ?? 0) + 1;
    }
    await done("evidence_validation", valid.length);

    await start("deduplication");
    let findings = deduplicateFindings(valid);
    if (findings.length >= 3) {
      try {
        const cp = buildConsolidationPrompt(findings);
        const { text, meta } = await generateAIText({ role: "manuscript_auditor", config, userId, bookId, request: { ...cp, json: true, temperature: 0, reasoning: "low" } }, deps);
        models.add(meta.model);
        findings = applyConsolidation(findings, text);
      } catch (e) { console.warn("[run-manuscript-audit] consolidation skipped", e instanceof Error ? e.message : e); }
    }
    if (findings.length) {
      const { error } = await db.from("manuscript_audit_findings").insert(findings.map((f) => toFindingRow(f, { auditId, bookId, userId })));
      if (error) throw new Error(error.message);
    }
    await done("deduplication", findings.length);

    await db.from("manuscript_audits").update({
      status: anyFailed ? "PARTIAL" : "COMPLETE", summary: summarizeFindings(findings, rejected), stage_progress: progress,
      model_identifier: [...models].join(",") || null, completed_at: now(),
    }).eq("id", auditId);
    console.log("[run-manuscript-audit]", JSON.stringify({ bookId, auditId, findings: findings.length, rejected, partial: anyFailed }));
  } catch (e) {
    console.error("[run-manuscript-audit] run failed", e);
    await db.from("manuscript_audits").update({ status: "FAILED", error: e instanceof Error ? e.message.slice(0, 500) : "failed", stage_progress: progress, completed_at: now() }).eq("id", auditId);
  }
}
