// Phase H — owner-only review of held drafts and canon decisions. Every write goes through
// owner-verified database functions; acceptance re-runs full validation under a fenced lease.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { createAIDeps, loadBookModelConfig } from "../_shared/ai/server.ts";
import { verifyBookOwnership } from "../_shared/narrative/supabaseRepo.ts";
import { contentHash } from "../_shared/narrative/extraction.ts";
import { loadProgressiveState } from "../_shared/narrative/planning/pipelineRepo.ts";
import { LEASE_TTL_SECONDS } from "../_shared/narrative/planning/pipeline.ts";
import { buildEvalContext } from "../_shared/narrative/planning/evalContext.ts";
import { buildEvaluatorPrompt } from "../_shared/narrative/planning/evaluator.ts";
import { modelCallers, persistOutcome, runPreAcceptance } from "../_shared/narrative/planning/preAcceptanceServer.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const int = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 10000 ? (v as number) : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: claims } = await userDb.auth.getClaims(authHeader.slice(7));
    const userId = claims?.claims?.sub as string | undefined;
    if (!userId) return json({ error: "Unauthorized" }, 401);
    const raw = await req.text();
    if (raw.length > 150_000) return json({ error: "Payload too large" }, 413);
    let body: Record<string, any>; try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON" }, 400); }
    const action = String(body.action ?? "");

    // Owner decisions run as the signed-in user so database ownership checks use auth.uid().
    if (action === "decide") {
      if (!UUID.test(String(body.logId))) return json({ error: "Invalid logId" }, 400);
      if (!["KEEP_CANON_REVISE_PROSE", "ACCEPT_PROSE_UPDATE_CANON", "DISMISS"].includes(body.decision)) return json({ error: "Invalid decision" }, 400);
      const { data, error } = await userDb.rpc("decide_canon_reconciliation", { p_log_id: body.logId, p_decision: body.decision, p_rationale: String(body.rationale ?? "").slice(0, 2000), p_resulting_changes: [], p_replan: body.replan === true });
      return error ? json({ error: error.message }, 400) : json(data);
    }
    if (action === "discard") {
      if (!UUID.test(String(body.candidateId))) return json({ error: "Invalid candidateId" }, 400);
      const { data, error } = await userDb.rpc("discard_candidate_draft", { p_candidate_id: body.candidateId });
      return error ? json({ error: error.message }, 400) : json(data);
    }

    if (!UUID.test(String(body.bookId))) return json({ error: "Invalid bookId" }, 400);
    const bookId = String(body.bookId);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const owned = await verifyBookOwnership(db, bookId, userId);
    if (!owned) return json({ error: "Book not found" }, 404);

    if (action === "blast_radius" || action === "confirm_memory") {
      const ch = int(body.chapter), sub = int(body.subsection);
      if (ch === null || sub === null) return json({ error: "Invalid position" }, 400);
      const fn = action === "blast_radius" ? "calculate_downstream_blast_radius" : "confirm_section_memory";
      const { data, error } = await userDb.rpc(fn, { p_book_id: bookId, p_chapter: ch, p_sub: sub });
      return error ? json({ error: error.message }, 400) : json(data);
    }

    if (action === "status") {
      const [{ data: candidates }, { data: logs }, { data: findings }] = await Promise.all([
        db.from("book_candidate_drafts").select("*").eq("book_id", bookId).in("validation_status", ["BLOCKED_MATERIAL", "NEEDS_AUTHOR_REVIEW"]).order("created_at", { ascending: false }).limit(50),
        db.from("canon_reconciliation_logs").select("id, chapter_index, subsection_index, severity, discrepancy_type, description, prose_excerpt, canon_reference, decision, rationale, application_status, candidate_id, created_at").eq("book_id", bookId).not("dedup_key", "like", "selftest_%").order("created_at", { ascending: false }).limit(200),
        db.from("editorial_validation_findings").select("*").eq("book_id", bookId).eq("status", "OPEN").order("created_at", { ascending: false }).limit(200),
      ]);
      return json({ candidates: candidates ?? [], logs: logs ?? [], findings: findings ?? [] });
    }

    // Client polling after a progressive section streams: accepted, held, or still validating.
    if (action === "section_status") {
      const ch = int(body.chapter), sub = int(body.subsection);
      if (ch === null || sub === null) return json({ error: "Invalid position" }, 400);
      const since = typeof body.since === "string" ? body.since : new Date(Date.now() - 10 * 60_000).toISOString();
      const [{ data: acc }, { data: cand }] = await Promise.all([
        db.from("book_section_acceptances").select("id, manuscript_status, created_at").eq("book_id", bookId).eq("chapter_index", ch).eq("subsection_index", sub).in("manuscript_status", ["ACCEPTED", "ESTABLISHED"]).gte("created_at", since).limit(1),
        db.from("book_candidate_drafts").select("id, validation_status, created_at").eq("book_id", bookId).eq("chapter_index", ch).eq("subsection_index", sub).gte("created_at", since).order("created_at", { ascending: false }).limit(1),
      ]);
      if (acc?.length) {
        const { data: b } = await db.from("books").select("outline").eq("id", bookId).maybeSingle();
        return json({ state: "accepted", text: b?.outline?.chapters?.[ch]?.subsections?.[sub]?.content ?? null });
      }
      if (cand?.length) return json({ state: "held", candidateId: cand[0].id, status: cand[0].validation_status });
      return json({ state: "pending" });
    }

    if (action === "accept") {
      if (!UUID.test(String(body.candidateId))) return json({ error: "Invalid candidateId" }, 400);
      const { data: c } = await db.from("book_candidate_drafts").select("*").eq("id", body.candidateId).eq("book_id", bookId).eq("user_id", userId).maybeSingle();
      if (!c || !["BLOCKED_MATERIAL", "NEEDS_AUTHOR_REVIEW"].includes(c.validation_status)) return json({ error: "Candidate not open" }, 409);
      const { data: linked } = await db.from("canon_reconciliation_logs").select("id, decision, canon_reference").eq("candidate_id", c.id);
      if ((linked ?? []).some((l) => l.decision === "PENDING")) return json({ error: "RECONCILIATION_REQUIRED", message: "Decide every contradiction before accepting." }, 409);
      const edited = typeof body.editedText === "string" && body.editedText.trim() ? body.editedText.trim().slice(0, 60_000) : null;
      const text = edited ?? c.draft_text;
      const { data: bk } = await db.from("books").select("book_type, controls, outline").eq("id", bookId).maybeSingle();
      const ps = await loadProgressiveState(db, bookId, userId, bk!.book_type, bk!.outline, c.chapter_index, c.subsection_index);
      if (!ps.plan.usable) return json({ error: "PLAN_REQUIRED" }, 409);
      const { data: factRows } = await db.from("canonical_facts").select("id, subject, predicate, value, is_canonical, conflict_status, canon_status, source_chapter_index, source_subsection_index").eq("book_id", bookId).eq("canon_status", "ESTABLISHED").limit(400);
      const ctx = buildEvalContext({ bookType: bk!.book_type, plan: ps.plan, chapterIndex: c.chapter_index, anchors: ps.anchors as never, facts: factRows ?? [], controls: bk!.controls, approvedLogs: linked ?? [] });
      // Reconciliation never bypasses validation: the (edited) candidate is fully re-checked.
      if (body.dryRun === true) return json({ dryRun: true, prompt: buildEvaluatorPrompt(text, ctx), approvedCanonKeys: ctx.approvedCanonKeys });
      const { data: allowed } = await db.rpc("check_rate_limit", { _user_id: userId, _function_name: "candidate-review", _max_per_hour: 60, _max_per_day: 300 });
      if (allowed === false) return json({ error: "Rate limit exceeded" }, 429);
      const cfg = await loadBookModelConfig(db, bookId, userId);
      const { evaluate, repair } = modelCallers(cfg, userId, bookId, createAIDeps(db, userId));
      const r = await runPreAcceptance(text, ctx, evaluate, repair, { warnRatio: Number((bk!.controls as any)?.revisionWarnRatio) || undefined });
      const hash = contentHash(r.text);
      if (r.decision !== "accept") {
        const saved = await persistOutcome(r, { db, bookId, userId, chapter: c.chapter_index, sub: c.subsection_index, hash, masterPlanId: c.master_plan_id, origin: edited ? "author_edit" : "retry", parentId: c.id });
        return json({ status: "held", decision: r.decision, candidateId: saved.candidateId, findings: r.findings, usage: r.usage }, 409);
      }
      const worker = `cr_${crypto.randomUUID()}`;
      const { data: lease } = await db.rpc("acquire_generation_lease", { p_book_id: bookId, p_user_id: userId, p_chapter: c.chapter_index, p_sub: c.subsection_index, p_worker: worker, p_ttl_seconds: LEASE_TTL_SECONDS });
      if (!lease?.acquired) return json({ error: "SECTION_BUSY" }, 409);
      const { data: done, error } = await db.rpc("commit_candidate_draft", { p_candidate_id: c.id, p_user_id: userId, p_worker: worker, p_token: Number(lease.fencing_token), p_text: r.text, p_hash: hash, p_replace: body.replaceAccepted === true });
      if (error) {
        await db.rpc("release_generation_lease", { p_lease_id: lease.lease_id, p_worker: worker, p_token: Number(lease.fencing_token) }).then(() => {}, () => {});
        return json({ error: error.message }, 409);
      }
      await db.rpc("write_accepted_outline_text", { p_book_id: bookId, p_user_id: userId, p_chapter: c.chapter_index, p_sub: c.subsection_index, p_text: r.text, p_hash: hash }).then(() => {}, () => {});
      await persistOutcome(r, { db, bookId, userId, chapter: c.chapter_index, sub: c.subsection_index, hash, masterPlanId: c.master_plan_id, origin: "retry" });
      return json({ status: "accepted", result: done, usage: r.usage, text: r.text });
    }
    return json({ error: "Invalid action" }, 400);
  } catch (e) {
    console.error("candidate-review error:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
