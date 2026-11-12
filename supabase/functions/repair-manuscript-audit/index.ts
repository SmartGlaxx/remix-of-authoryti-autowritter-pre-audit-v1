import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.25.76";
import { generateAIText } from "../_shared/ai/client.ts";
import { createAIDeps, loadBookModelConfig } from "../_shared/ai/server.ts";
import { verifyBookOwnership } from "../_shared/narrative/supabaseRepo.ts";
import { buildManuscriptSections, manuscriptText, sha256Hex, renderManuscriptDigest } from "../_shared/narrative/audit.ts";
import { eligibleForRepair, prepareAuditRepair, auditRepairPrompt, auditRepairValidationPrompt, repairValidationPassed, MAX_AUDIT_REPAIR_ROUNDS } from "../_shared/narrative/auditRepair.ts";
import { contentHash } from "../_shared/narrative/extraction.ts";
import { loadProgressiveState } from "../_shared/narrative/planning/pipelineRepo.ts";
import { buildEvalContext } from "../_shared/narrative/planning/evalContext.ts";
import { stageOneFindings, buildEvaluatorPrompt, parseEvaluation } from "../_shared/narrative/planning/evaluator.ts";
import { createLeaseHeartbeat } from "../_shared/narrative/planning/pipeline.ts";
import { loadNarratorContext } from "../_shared/narrative/knowledgeRepo.ts";
import { renderWriterPrompt, resolveWriter } from "../_shared/writers/personas.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
type Db = ReturnType<typeof createClient>;
type Row = Record<string, any>;
const bodySchema = z.object({ action: z.enum(["version", "start", "resume", "status"]).default("start"), bookId: z.string().uuid().optional(), auditId: z.string().uuid().optional(), runId: z.string().uuid().optional(), authorizeRepair: z.boolean().optional(), testMode: z.boolean().optional() }).strict();
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const checked = async (query: PromiseLike<any>) => { const r = await query; if (r.error) throw new Error(r.error.message); return r.data; };

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Bearer ") || !req.headers.get("apikey")) return json({ error: "Unauthorized" }, 401);
    const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key || !service) throw new Error("Cloud configuration unavailable");
    const userDb = createClient(url, key, { global: { headers: { Authorization: auth } } });
    const { data, error } = await userDb.auth.getClaims(auth.slice(7));
    const userId = data?.claims?.sub;
    if (error || typeof userId !== "string") return json({ error: "Unauthorized" }, 401);
    const raw = await req.text();
    if (raw.length > 2000) return json({ error: "Payload too large" }, 413);
    const parsed = bodySchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return json({ error: "Invalid repair request" }, 400);
    const body = parsed.data;
    if (body.action === "version") return json({ version: "audit-fixer-2026-11-12", testModeBlocksPaidAI: true });
    if (!body.bookId) return json({ error: "Book required" }, 400);
    const db = createClient(url, service);
    if (!await verifyBookOwnership(db, body.bookId, userId)) return json({ error: "Book not found" }, 404);
    if (body.action === "status") {
      const stale: Row[] = await checked(db.from("manuscript_repair_runs").select("id,patches").eq("book_id", body.bookId).eq("user_id", userId).in("status", ["RUNNING", "SYNCING"]).lt("updated_at", new Date(Date.now() - 10 * 60_000).toISOString()));
      for (const r of stale) await checked(db.from("manuscript_repair_runs").update({ status: r.patches.length ? "NEEDS_SYNC" : "FAILED", error: "Repair interrupted; saved changes are retained" }).eq("id", r.id).lt("updated_at", new Date(Date.now() - 10 * 60_000).toISOString()));
      const runs = await checked(db.from("manuscript_repair_runs").select("id,status,outcomes,patches,sync_cursor,error,created_at").eq("book_id", body.bookId).eq("user_id", userId).order("created_at", { ascending: false }).limit(10));
      return json({ runs });
    }
    // No mock repair can authorize a real manuscript change, and no test request can spend credit.
    if (body.testMode || req.headers.get("x-ai-test-mode") === "1") return json({ error: "test_mode_blocked" }, 403);
    if (body.authorizeRepair !== true) return json({ error: "Repair authorization required" }, 400);
    const allowed = await checked(db.rpc("check_rate_limit", { _user_id: userId, _function_name: "repair-manuscript-audit", _max_per_hour: 10, _max_per_day: 30 }));
    if (allowed !== true) return json({ error: "Repair limit reached" }, 429);
    let run: Row;
    if (body.action === "resume") {
      if (!body.runId) return json({ error: "Run required" }, 400);
      run = await checked(db.from("manuscript_repair_runs").select("*").eq("id", body.runId).eq("book_id", body.bookId).eq("user_id", userId).eq("status", "NEEDS_SYNC").maybeSingle());
      if (!run) return json({ error: "Run cannot be resumed" }, 409);
      const claim = await checked(db.from("manuscript_repair_runs").update({ status: "SYNCING", error: null }).eq("id", run.id).eq("status", "NEEDS_SYNC").select("id"));
      if (!claim.length) return json({ error: "Already resuming" }, 409);
    } else {
      if (!body.auditId) return json({ error: "Completed audit required" }, 400);
      const audit = await checked(db.from("manuscript_audits").select("*").eq("id", body.auditId).eq("book_id", body.bookId).eq("user_id", userId).eq("status", "COMPLETE").maybeSingle());
      const book = await checked(db.from("books").select("outline,controls").eq("id", body.bookId).single());
      if (!audit) return json({ error: "A complete audit is required" }, 409);
      if (book.controls?.planning_pipeline !== "progressive") return json({ error: "Automatic repairs require Progressive Planning; Standard writing is unchanged" }, 409);
      const sections = buildManuscriptSections(book.outline);
      if (await sha256Hex(manuscriptText(sections)) !== audit.manuscript_hash) return json({ error: "Book changed; run a fresh audit first" }, 409);
      // No hidden truncation: don't repair an exhaustively unchecked large manuscript.
      if (JSON.stringify(book.outline).length > 300_000) return json({ error: "This manuscript exceeds the safe full-text repair size" }, 409);
      const findings = await checked(db.from("manuscript_audit_findings").select("*").eq("audit_id", audit.id));
      if (!findings.some(eligibleForRepair)) return json({ error: "No verified, unprotected conflicts to repair" }, 409);
      run = await checked(db.from("manuscript_repair_runs").insert({ book_id: body.bookId, user_id: userId, audit_id: audit.id, original_outline: book.outline }).select().single());
    }
    const work = execute(db, run, auth, key, body.action === "resume");
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work); else await work;
    return json({ runId: run.id, status: body.action === "resume" ? "SYNCING" : "RUNNING" }, 202);
  } catch (e) { return json({ error: e instanceof Error ? e.message : "Repair failed" }, 500); }
});

async function execute(db: Db, run: Row, auth: string, key: string, resume: boolean) {
  const update = (patch: Row) => checked(db.from("manuscript_repair_runs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", run.id));
  try {
    const config = await loadBookModelConfig(db, run.book_id, run.user_id);
    const deps = createAIDeps(db, run.user_id);
    const call = async (role: "continuity_reviser" | "manuscript_auditor" | "continuity_checker", p: { system: string; user: string }) => {
      const { text } = await generateAIText({ role, config, userId: run.user_id, bookId: run.book_id, request: { ...p, json: true } }, deps);
      return text;
    };
    if (!resume) {
      const findings: Row[] = await checked(db.from("manuscript_audit_findings").select("*").eq("audit_id", run.audit_id).order("confidence", { ascending: false }));
      const originals = buildManuscriptSections(run.original_outline);
      const outcomes: Row[] = [];
      for (const f of findings) {
        if (!eligibleForRepair(f as never)) { outcomes.push({ findingId: f.id, status: "SKIPPED", reason: "Protected, uncertain, advisory or closed finding" }); continue; }
        let repaired = false;
        let reason = "No safe correction";
        for (let round = 0; round < MAX_AUDIT_REPAIR_ROUNDS && !repaired; round++) {
          const worker = `audit-${run.id}-${f.id}-${round}`;
          const leases: { lease_id: string; fencing_token: number }[] = [];
          const hearts: ReturnType<typeof createLeaseHeartbeat>[] = [];
          try {
            const book = await checked(db.from("books").select("*").eq("id", run.book_id).single());
            const sections = buildManuscriptSections(book.outline);
            if (!sections.some(s => s.content.includes(f.evidence_excerpt))) throw new Error("Finding evidence changed after an earlier repair; fresh audit required");
            const [anchors, facts, decisions, plan, ready] = await Promise.all([
              checked(db.from("narrative_exact_anchors").select("*").eq("book_id", run.book_id).eq("is_active", true)),
              checked(db.from("canonical_facts").select("*").eq("book_id", run.book_id).in("authority", ["USER_CANON", "OUTLINE_CANON"])),
              checked(db.from("canon_reconciliation_logs").select("decision,canon_reference,rationale,prose_excerpt").eq("book_id", run.book_id).neq("decision", "PENDING")),
              checked(db.from("book_master_plans").select("plan_skeleton").eq("book_id", run.book_id).eq("status", "APPROVED").order("version", { ascending: false }).limit(1)),
              checked(db.from("book_progressive_plans").select("chapter_index,subsection_index,content").eq("book_id", run.book_id).eq("plan_status", "READY")),
            ]);
            const protectedContext = JSON.stringify({ anchors, facts, decisions });
            const guidance = JSON.stringify({ master: plan, ready, setup: book.story_setup, controls: book.controls, voice: renderWriterPrompt(resolveWriter(book.controls, book.book_type), book.book_type, book.controls?.authorId), audience: book.audience });
            if (protectedContext.length + guidance.length + JSON.stringify(book.outline).length > 350_000) throw new Error("Complete repair context exceeds safe size");
            const full = renderManuscriptDigest(sections, Infinity);
            const proposal = await call("continuity_reviser", auditRepairPrompt(f as never, full, protectedContext, guidance));
            const protectedTexts = [...anchors.map((a: Row) => a.exact_text), ...facts.map((a: Row) => a.source_excerpt), ...decisions.map((a: Row) => a.prose_excerpt)].filter((x: unknown): x is string => typeof x === "string");
            const repair = prepareAuditRepair(proposal, sections, originals, protectedTexts);
            for (const change of repair.changes) {
              const lease = await checked(db.rpc("acquire_generation_lease", { p_book_id: run.book_id, p_user_id: run.user_id, p_chapter: change.chapterIndex, p_sub: change.subsectionIndex, p_worker: worker, p_ttl_seconds: 120 }));
              if (!lease?.acquired) throw new Error("Section is being written; repair deferred");
              leases.push(lease);
              hearts.push(createLeaseHeartbeat(async () => { const r = await db.rpc("renew_generation_lease", { p_lease_id: lease.lease_id, p_worker: worker, p_token: lease.fencing_token, p_ttl_seconds: 120 }); return !r.error && r.data?.renewed === true; }));
              const ps = await loadProgressiveState(db, run.book_id, run.user_id, book.book_type, book.outline, change.chapterIndex, change.subsectionIndex);
              if (!ps.plan.usable) throw new Error("Approved section plan required");
              const ctx = buildEvalContext({ bookType: book.book_type, plan: ps.plan, chapterIndex: change.chapterIndex, anchors: ps.anchors, facts, controls: book.controls });
              const narrator = await loadNarratorContext(db, run.book_id, run.user_id, { chapterIndex: change.chapterIndex, subsectionIndex: change.subsectionIndex }, ps.plan.section);
              if (narrator) { ctx.narration = narrator.narration; ctx.lifeRecords = narrator.lifeRecords; ctx.sceneDate = narrator.sceneDate; }
              ctx.knownNames = (book.outline?.characters ?? []).map((c: Row) => c.name).filter(Boolean);
              ctx.lockedLooks = (book.outline?.characters ?? []).filter((c: Row) => c.reference?.locked && c.reference?.features).map((c: Row) => ({ name: String(c.name), features: c.reference.features, locked: true }));
              if (stageOneFindings(change.text, ctx).some(x => x.severity === "material" || x.code === "BANNED_EXPRESSION" || x.code === "MARKDOWN" || x.code === "META_LABEL")) throw new Error("Deterministic safety check failed");
              const evaluation = parseEvaluation(await call("continuity_checker", buildEvaluatorPrompt(change.text, ctx)), ctx, change.text);
              if (evaluation.some(x => x.severity === "material" || x.severity === "moderate")) throw new Error("Section validation failed");
            }
            const validated = await call("manuscript_auditor", auditRepairValidationPrompt(full, renderManuscriptDigest(repair.sections, Infinity), f as never, protectedContext, guidance));
            if (!repairValidationPassed(validated)) throw new Error("Whole-book revalidation rejected repair");
            for (const heart of hearts) if (!await heart.beat()) throw new Error("Repair lease expired");
            await checked(db.rpc("commit_audit_repair", { p_run_id: run.id, p_user_id: run.user_id, p_worker: worker, p_changes: repair.changes.map((c, i) => ({ ...c, token: leases[i].fencing_token, hash: contentHash(c.text) })), p_details: { findingId: f.id, round: round + 1, rationale: repair.proposal.rationale, options: repair.proposal.options, selected: repair.proposal.selected, validation: { passed: true, coverageComplete: true, regressions: [] } } }));
            repaired = true;
          } catch (e) { reason = e instanceof Error ? e.message : "Repair failed"; }
          finally {
            hearts.forEach(h => h.stop());
            for (const l of leases) await db.rpc("release_generation_lease", { p_lease_id: l.lease_id, p_worker: worker, p_token: l.fencing_token });
          }
        }
        outcomes.push({ findingId: f.id, status: repaired ? "COMMITTED" : "HELD", reason: repaired ? "Validated correction saved; memory sync pending" : reason });
        await update({ outcomes });
      }
      const saved = await checked(db.from("manuscript_repair_runs").select("patches").eq("id", run.id).single());
      if (!saved.patches.length) { await update({ status: "COMPLETE" }); return; }
      await update({ status: "SYNCING" });
    }
    await replayMemory(db, run.id, run.user_id, auth, key);
  } catch (e) {
    const saved = await checked(db.from("manuscript_repair_runs").select("patches").eq("id", run.id).single());
    await update({ status: saved.patches.length ? "NEEDS_SYNC" : "FAILED", error: e instanceof Error ? e.message.slice(0, 500) : "Repair failed" });
  }
}

async function replayMemory(db: Db, runId: string, userId: string, auth: string, key: string) {
  await checked(db.rpc("prepare_audit_memory_replay", { p_run_id: runId, p_user_id: userId }));
  const run = await checked(db.from("manuscript_repair_runs").select("*").eq("id", runId).single());
  const book = await checked(db.from("books").select("outline").eq("id", run.book_id).single());
  const sections = buildManuscriptSections(book.outline).filter(s => s.status === "completed" && s.content && s.chapterIndex * 10000 + s.subsectionIndex >= run.earliest_position);
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) throw new Error("Cloud configuration unavailable");
  for (let i = run.sync_cursor; i < sections.length; i++) {
    const s = sections[i];
    const response = await fetch(`${url}/functions/v1/extract-narrative-state`, { method: "POST", headers: { Authorization: auth, apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ bookId: run.book_id, chapterIndex: s.chapterIndex, subsectionIndex: s.subsectionIndex, strictSync: true }) });
    const result = await response.json();
    if (!response.ok || !(result.status === "completed" || result.status === "skipped" && result.reason === "already_processed")) throw new Error(`Story memory not synchronized at ${s.chapterIndex + 1}.${s.subsectionIndex + 1}`);
    const ext = await checked(db.from("narrative_extractions").select("content_hash,status,applied").eq("book_id", run.book_id).eq("chapter_index", s.chapterIndex).eq("subsection_index", s.subsectionIndex).single());
    if (ext.status !== "completed" || ext.content_hash !== contentHash(s.content) || !ext.applied?.sectionMemory) throw new Error("Saved paragraph memory does not match repaired prose");
    await checked(db.from("manuscript_repair_runs").update({ sync_cursor: i + 1, updated_at: new Date().toISOString() }).eq("id", runId));
  }
  // Never close a finding until saved prose and every downstream memory section read back successfully.
  const outcomes = (run.outcomes ?? []).map((o: Row) => o.status === "COMMITTED" ? { ...o, status: "RESOLVED", reason: "Saved and synchronized; repair history retained" } : o);
  await checked(db.from("manuscript_repair_runs").update({ status: "COMPLETE", outcomes, error: null, updated_at: new Date().toISOString() }).eq("id", runId));
}