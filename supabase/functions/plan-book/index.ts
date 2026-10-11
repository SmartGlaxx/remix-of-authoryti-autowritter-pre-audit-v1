// Phase D — AI progressive planning endpoint (owner-only). Five services: story alternatives,
// master plan, chapter expansion, section plans, writing beats; plus owner approval checkpoints.
// Never writes prose, books, story memory or canon. dryRun returns prompts with no AI call or write.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { generateAIText } from "../_shared/ai/client.ts";
import { createAIDeps, loadBookModelConfig } from "../_shared/ai/server.ts";
import { statusForAIError, failClosedDeps } from "../_shared/ai/client.ts";
import { verifyBookOwnership } from "../_shared/narrative/supabaseRepo.ts";
import { adapterForBookType } from "../_shared/narrative/planning/adapters.ts";
import type { ChapterPlan, MasterPlanSkeleton } from "../_shared/narrative/planning/engine.ts";
import {
  STORY_ALTERNATIVE_COUNTS, assertAlternativesEligible, assertConceptsEligible, buildConceptsPrompt, parseConcepts, conceptGuidance, type NonfictionConcept, buildAlternativesPrompt, buildBeatsPrompt, buildChapterPrompt, buildMasterPrompt,
  buildSectionPrompt, parseAlternatives, parseBeats, parseChapter, parseMaster, parseSections, planIdemKey, runChapterBatch, runWithRepair,
  type AlternativeCount, type BookBrief, type MasterContext, type ModelCall, type Prompt, type StoryAlternative,
} from "../_shared/narrative/planning/aiPlanning.ts";
import {
  normalizeSetup, validateSetup, lockedChanges, setupPlannerGuidance, setupBookColumns, buildTwistPrompt, parseTwists, recommendCast,
  mockAlternativesOutput, mockConceptsOutput, mockTwistsOutput, checkReviewDecision, type ReviewDecision,
} from "../_shared/narrative/planning/bookSetup.ts";
import { planKnowledgeWrites, type ExtractedKnowledge } from "../_shared/narrative/knowledge.ts";
import { loadIdentitiesFor } from "../_shared/narrative/knowledgeRepo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = ["edit_plan", "alternatives", "concepts", "twists", "master", "chapters", "sections", "beats", "approve_master", "approve_plans", "status", "setup_get", "setup_save", "recommend_cast", "identity_reviews", "resolve_review"];
// Story alternatives, concepts and twists use the real planner model for authors. Test mode (and STORY_AI_ENGINE=mock) always uses the free deterministic engine.
const storyLive = () => Deno.env.get("STORY_AI_ENGINE") !== "mock";
// Deployment handshake: test harnesses must read this BEFORE any AI-capable request and abort on mismatch,
// so a stale deployment (which would ignore testMode) is never sent a request that could reach a paid model.
export const PLAN_BOOK_BUILD = "p4-failclosed-1";
const s = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error: claimsErr } = await userDb.auth.getClaims(authHeader.slice(7));
    const userId = claims?.claims?.sub as string | undefined;
    if (claimsErr || !userId) return json({ error: "Unauthorized" }, 401);

    const raw = await req.text();
    if (raw.length > 120_000) return json({ error: "Payload too large" }, 413);
    let body: Record<string, any>;
    try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON" }, 400); }
    const action = body.action;
    if (action === "version") return json({ build: PLAN_BOOK_BUILD, testModeSupported: true });
    if (!ACTIONS.includes(action)) return json({ error: "Invalid action" }, 400);

    // Owner checkpoints run as the signed-in user so database ownership checks use auth.uid().
    if (action === "approve_master") {
      if (!UUID.test(String(body.planId))) return json({ error: "Invalid planId" }, 400);
      const { data, error } = await userDb.rpc("approve_master_plan", { p_plan_id: body.planId });
      return error ? json({ error: error.message }, 400) : json(data);
    }
    if (action === "approve_plans") {
      const ids = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => UUID.test(String(x))).slice(0, 500) : [];
      if (!ids.length) return json({ error: "No plan ids" }, 400);
      const { data, error } = await userDb.rpc("approve_progressive_plans", { p_ids: ids });
      return error ? json({ error: error.message }, 400) : json(data);
    }

    if (typeof body.bookId !== "string" || !UUID.test(body.bookId)) return json({ error: "Invalid bookId" }, 400);
    const bookId = body.bookId;
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (!(await verifyBookOwnership(db, bookId, userId))) return json({ error: "Book not found" }, 404);
    const { data: book } = await db.from("books").select("title, book_type, genre, audience, theme, word_count, story_setup, universe_id, controls").eq("id", bookId).maybeSingle();
    if (!book) return json({ error: "Book not found" }, 404);
    try { adapterForBookType(book.book_type); } catch { return json({ error: "Unsupported book type" }, 400); }

    if (action === "status") {
      // The owner (author) sees the full plan, including planner-only synopsis and ending.
      const [{ data: masters }, { data: plans }] = await Promise.all([
        db.from("book_master_plans").select("id, version, status, approved_at, created_at, premise, master_synopsis, intended_ending, plan_skeleton").eq("book_id", bookId).eq("user_id", userId).order("version", { ascending: false }),
        db.from("book_progressive_plans").select("id, book_id, master_plan_id, plan_level, chapter_index, subsection_index, plan_status, version, content").eq("book_id", bookId).eq("user_id", userId).neq("plan_status", "SUPERSEDED"),
      ]);
      return json({ masters, plans });
    }

    // Author edits a not-yet-approved chapter or section summary. Saved as a new version
    // (the old PLANNED version is superseded by the same RPC); approved plans stay frozen.
    if (action === "edit_plan") {
      if (!UUID.test(String(body.planId))) return json({ error: "Invalid planId" }, 400);
      const { data: row } = await db.from("book_progressive_plans").select("*").eq("id", body.planId).eq("book_id", bookId).eq("user_id", userId).maybeSingle();
      if (!row) return json({ error: "Plan not found" }, 404);
      if (row.plan_status !== "PLANNED") return json({ error: "Approved plans can't be edited — only plans waiting for approval." }, 409);
      const f = (body.fields ?? {}) as Record<string, unknown>;
      const content = JSON.parse(JSON.stringify(row.content ?? {}));
      if (row.plan_level === "CHAPTER" && content.chapter) {
        if (typeof f.objective === "string" && f.objective.trim()) content.chapter.objective = s(f.objective, 4000);
        if (typeof f.stakes === "string") content.stakes = s(f.stakes, 4000);
        if (typeof f.focus === "string") content.focus = s(f.focus, 4000);
      } else if (row.plan_level === "SECTION" && content.section) {
        if (typeof f.objective === "string" && f.objective.trim()) content.section.objective = s(f.objective, 4000);
        content.detail = content.detail ?? {};
        for (const k of ["entry", "focus", "outcome"]) if (typeof f[k] === "string") content.detail[k] = s(f[k], 4000);
      } else return json({ error: "This plan type can't be edited here" }, 400);
      const { data, error } = await db.rpc("save_progressive_plan_batch", {
        p_book_id: bookId, p_user_id: userId, p_master_plan_id: row.master_plan_id, p_idem: planIdemKey(["edit", row.id, crypto.randomUUID()]),
        p_items: [{ plan_level: row.plan_level, chapter_index: row.chapter_index, subsection_index: row.subsection_index, content, dependencies: row.dependencies ?? [] }],
      });
      if (error) return json({ error: error.message }, 400);
      return json({ saved: data });
    }

    // ── Phase 4: Book Setup (server-validated; stored apart from prose) ──
    if (action === "setup_get") return json({ setup: normalizeSetup(book.story_setup), hasProse: (book.word_count ?? 0) > 0 });
    if (action === "setup_save") {
      const next = normalizeSetup(body.setup);
      const prev = normalizeSetup(book.story_setup);
      const hasProse = (book.word_count ?? 0) > 0;
      const locked = lockedChanges(prev, next, hasProse);
      if (locked.length) return json({ error: "SETUP_LOCKED", message: `Writing has started, so these can't change here: ${locked.join(", ")}. Use canon reconciliation instead.`, locked }, 409);
      const { data: pens } = await db.from("author_identities").select("id, pen_name").eq("user_id", userId);
      const issues = validateSetup(next, { bookType: book.book_type, penNames: pens ?? [], chapterCount: Number(body.chapterCount) || undefined });
      if (issues.some((i) => i.blocking)) return json({ error: "SETUP_INVALID", issues }, 422);
      // Ownership: universe, pen name and every persistent identity must belong to this user (and universe).
      if (next.universeId) { const { data } = await db.from("fictional_universes").select("id").eq("id", next.universeId).eq("user_id", userId).maybeSingle(); if (!data) return json({ error: "UNIVERSE_NOT_OWNED" }, 403); }
      if (next.penNameId && !(pens ?? []).some((p: any) => p.id === next.penNameId)) return json({ error: "PEN_NAME_NOT_OWNED" }, 403);
      const ids = next.cast.map((c) => c.identityId).filter(Boolean) as string[];
      if (ids.length) {
        const { data: rows } = await db.from("narrative_identities").select("id, universe_id").eq("user_id", userId).in("id", ids);
        if ((rows ?? []).length !== new Set(ids).size) return json({ error: "IDENTITY_NOT_OWNED" }, 403);
        if ((rows ?? []).some((r: any) => (r.universe_id ?? null) !== next.universeId)) return json({ error: "IDENTITY_OTHER_UNIVERSE", message: "A chosen character belongs to a different universe. Characters are never moved between universes." }, 409);
      }
      next.updatedAt = new Date().toISOString();
      const cols = setupBookColumns(next);
      const update: Record<string, unknown> = { story_setup: next, author_identity_id: cols.author_identity_id };
      if (!hasProse) Object.assign(update, { pov: cols.pov, narrative_vantage: cols.narrative_vantage, narrator_identity_id: cols.narrator_identity_id, universe_id: cols.universe_id, narrator_telling_date: cols.narrator_telling_date });
      const { error } = await db.from("books").update(update).eq("id", bookId).eq("user_id", userId);
      if (error) return json({ error: error.message }, 400);
      // Book-specific roles for persistent identities (permanent persona domains are untouched).
      for (const c of next.cast) if (c.identityId) {
        await db.from("book_identity_roles").upsert({ user_id: userId, book_id: bookId, identity_id: c.identityId, narrative_role: c.role }, { onConflict: "book_id,identity_id" });
      }
      return json({ setup: next, warnings: issues });
    }
    if (action === "recommend_cast") {
      const st = normalizeSetup(book.story_setup);
      const alt = st.selectedIndex !== null ? st.alternatives[st.selectedIndex] : null;
      const text = [alt?.summary, alt?.twist, alt?.ending, st.premise, book.theme].filter(Boolean).join("\n");
      const ids = await loadIdentitiesFor(db, userId, st.universeId);
      return json({ recommendations: recommendCast(text, ids, st.universeId, st.cast) });
    }
    if (action === "identity_reviews") {
      const { data } = await db.from("knowledge_identity_reviews").select("*").eq("book_id", bookId).eq("user_id", userId).eq("status", "PENDING").order("created_at");
      const candIds = [...new Set((data ?? []).flatMap((r: any) => r.candidate_identity_ids ?? []))];
      const { data: cands } = candIds.length ? await db.from("narrative_identities").select("id, display_name, aliases, level").in("id", candIds).eq("user_id", userId) : { data: [] };
      return json({ reviews: data ?? [], candidates: cands ?? [] });
    }
    if (action === "resolve_review") {
      if (!UUID.test(String(body.reviewId))) return json({ error: "Invalid reviewId" }, 400);
      const { data: rv } = await db.from("knowledge_identity_reviews").select("*").eq("id", body.reviewId).eq("book_id", bookId).eq("user_id", userId).maybeSingle();
      if (!rv) return json({ error: "Not found" }, 404);
      const decision = String(body.decision) as ReviewDecision;
      const err = checkReviewDecision(rv, decision, body.identityId);
      if (err) return json({ error: err }, 409);
      if (decision === "defer") {
        await db.from("knowledge_identity_reviews").update({ deferred_at: new Date().toISOString(), resolution_note: s(body.note, 500) || null }).eq("id", rv.id);
        return json({ status: "deferred" });
      }
      if (decision === "dismiss") {
        await db.from("knowledge_identity_reviews").update({ status: "DISMISSED", resolution_note: s(body.note, 500) || null }).eq("id", rv.id).eq("status", "PENDING");
        return json({ status: "dismissed" });
      }
      const universeId = book.universe_id ?? null;
      let identityId: string;
      if (decision === "confirm_existing") {
        const { data: idRow } = await db.from("narrative_identities").select("id, universe_id").eq("id", body.identityId).eq("user_id", userId).maybeSingle();
        if (!idRow || (idRow.universe_id ?? null) !== universeId) return json({ error: "That character is not in this book's universe" }, 409);
        identityId = idRow.id;
      } else {
        // Explicitly a different person: a new lightweight identity (author's decision, never a merge).
        const name = s(body.newName, 120) || rv.character_name;
        const { data: created, error } = await db.from("narrative_identities").insert({ user_id: userId, universe_id: universeId, display_name: name, aliases: name === rv.character_name ? [] : [rv.character_name], level: "story_character", kind: "person", origin_book_id: bookId, seed_details: {} }).select("id").single();
        if (error) return json({ error: error.message }, 400);
        identityId = created.id;
      }
      // Re-plan just this item against the chosen identity: same deterministic dedup key → idempotent.
      const [chS, subS] = String(rv.source_section_key).split(":").map(Number);
      const all = await loadIdentitiesFor(db, userId, universeId);
      const chosen = all.find((x) => x.id === identityId);
      const plan = planKnowledgeWrites([rv.payload as ExtractedKnowledge], { identities: [{ ...(chosen ?? { id: identityId, displayName: rv.character_name, aliases: [], universeId }), aliases: [...(chosen?.aliases ?? []), rv.character_name] }], universeId, bookId, chapterIndex: chS, subsectionIndex: subS, contentHash: rv.content_hash });
      if (plan.rows.length) {
        const r = plan.rows[0];
        const { error } = await db.from("knowledge_acquisitions").upsert([{ user_id: userId, book_id: bookId, universe_id: universeId, identity_id: identityId, claim: r.claim, source: r.source,
          source_identity_id: r.source_identity_id, certainty: r.certainty, learned_date: r.learned_date, learned_chapter_index: r.learned_chapter_index, learned_subsection_index: r.learned_subsection_index,
          knowledge_kind: r.knowledge_kind, truth_status: r.truth_status, evidence: r.evidence, scene_point: r.scene_point, extraction_id: `review:${rv.id}`, source_section_key: rv.source_section_key,
          content_hash: rv.content_hash, dedup_key: r.dedup_key }], { onConflict: "dedup_key", ignoreDuplicates: true });
        if (error) return json({ error: error.message }, 400);
      }
      await db.from("knowledge_identity_reviews").update({ status: "RESOLVED", resolved_identity_id: identityId, resolution_note: s(body.note, 500) || null }).eq("id", rv.id).eq("status", "PENDING");
      return json({ status: "resolved", identityId, recorded: plan.rows.length });
    }

    const dryRun = body.dryRun === true;
    if (!dryRun) {
      const { data: allowed } = await db.rpc("check_rate_limit", { _user_id: userId, _function_name: "plan-book", _max_per_hour: 120, _max_per_day: 600 });
      if (allowed === false) return json({ error: "Rate limit exceeded" }, 429);
    }
    const config = await loadBookModelConfig(db, bookId, userId);
    // Fail-closed test mode: every model call is answered by a mock or blocked; no key is ever reachable.
    const testMode = body.testMode === true || req.headers.get("x-ai-test-mode") === "1";
    const deps = testMode ? failClosedDeps(createAIDeps(db, userId)) : createAIDeps(db, userId);
    const prompts: Prompt[] = [];
    const call: ModelCall = async (p) => {
      prompts.push(p);
      if (dryRun) throw new DryRunStop();
      const { text } = await generateAIText({ role: "planner", config, userId, bookId, request: { system: p.system, user: p.user, json: true } }, deps);
      return text;
    };
    // Free deterministic engine for story services (same prompts, parsers and repair loop as live).
    const storyCall = (mockOut: string): ModelCall => storyLive() && !testMode ? call : async (p) => { prompts.push(p); if (dryRun) throw new DryRunStop(); return mockOut; };
    // Optional idea-explorer overrides (alternatives/concepts only): any known book type + sub-category and extra preferences.
    let ovType = book.book_type;
    if ((action === "alternatives" || action === "concepts") && typeof body.bookType === "string") {
      try { adapterForBookType(body.bookType); ovType = body.bookType; } catch { return json({ error: "Unknown book type" }, 400); }
    }
    const ex = (body.explore && typeof body.explore === "object") ? body.explore as Record<string, unknown> : {};
    const extra = [
      s(ex.tone, 80) && `Tone: ${s(ex.tone, 80)}`,
      s(ex.setting, 300) && `Setting / time period: ${s(ex.setting, 300)}`,
      s(ex.comparables, 300) && `Similar in spirit to: ${s(ex.comparables, 300)} (do not copy them)`,
      s(ex.avoid, 300) && `Avoid: ${s(ex.avoid, 300)}`,
      s(ex.originality, 20) && `Originality: ${s(ex.originality, 20) === "bold" ? "bold, unexpected, high-concept options" : s(ex.originality, 20) === "safe" ? "familiar, market-proven options" : "a balanced mix of familiar and fresh"}`,
    ].filter(Boolean).join("\n");
    const brief: BookBrief = {
      title: book.title, bookType: ovType, genre: s(body.genre, 120) || book.genre, audience: s(body.audience, 120) || book.audience,
      premise: s(body.premise, 6000) || book.theme, guidance: [s(body.guidance, 6000), extra].filter(Boolean).join("\n") || null,
      targetWords: Math.min(400_000, Math.max(1000, Number(body.targetWords) || 50_000)),
      chapterCount: Math.min(80, Math.max(1, Number(body.chapterCount) || 12)),
      series: null,
    };
    const ser = (book as any).controls?.series;
    if (ser?.enabled && Number(ser.books) > 1) brief.seriesPlan = { books: Math.min(12, Math.max(2, Math.round(Number(ser.books)))) };
    // Author-configured banned words (book controls, or the list sent with an idea request) apply to every planning service.
    const bannedSrc = Array.isArray(body.bannedWords) ? body.bannedWords : Array.isArray((book as any).controls?.bannedWords) ? (book as any).controls.bannedWords : [];
    const banned = [...new Set(bannedSrc.map((w: unknown) => s(w, 60).toLowerCase()).filter(Boolean))].slice(0, 100);
    if (banned.length) brief.guidance = [brief.guidance, `Never use these words or phrases anywhere (titles, summaries, plans): ${banned.join(", ")}.`].filter(Boolean).join("\n");
    const cur = (ex.curriculum && typeof ex.curriculum === "object") ? ex.curriculum as Record<string, unknown> : null;
    if (cur && ovType === "textbook") brief.guidance = [brief.guidance, `Textbook following the ${s(cur.country, 120)} curriculum at ${s(cur.level, 120)} level. Chapters are curriculum units; sections are topic lessons with learning objectives, explanations, worked examples, practice questions and a summary.`].filter(Boolean).join("\n");

    try {
      if (action === "alternatives") {
        const count = Number(body.count) as AlternativeCount;
        try { assertAlternativesEligible(ovType, count); } catch (e) { return json({ error: (e as Error).message }, 400); }
        const fixed = normalizeSetup(book.story_setup).fixedRequirements;
        if (fixed.length) brief.guidance = [brief.guidance, `Fixed author requirements (keep in every alternative): ${fixed.join("; ")}`].filter(Boolean).join("\n");
        const pr = buildAlternativesPrompt(brief, count);
        const r = await runWithRepair(storyCall(mockAlternativesOutput(brief, count, fixed)), pr, (t) => parseAlternatives(t, count, summaryBand(ovType, brief.genre)));
        return r.ok ? json({ alternatives: r.value, attempts: r.attempts, engine: storyLive() && !testMode ? "live" : "mock" }) : json({ error: "PLAN_INVALID", issues: r.issues, attempts: r.attempts }, 422);
      }

      // Nonfiction concepts: a separate, genre-appropriate service (no twists, no plot).
      if (action === "concepts") {
        const count = Number(body.count) as AlternativeCount;
        try { assertConceptsEligible(ovType, count); } catch (e) { return json({ error: (e as Error).message }, 400); }
        const pr = buildConceptsPrompt(brief, count);
        const r = await runWithRepair(storyCall(mockConceptsOutput(brief, count)), pr, (t) => parseConcepts(t, count));
        return r.ok ? json({ concepts: r.value, attempts: r.attempts, engine: storyLive() && !testMode ? "live" : "mock" }) : json({ error: "PLAN_INVALID", issues: r.issues, attempts: r.attempts }, 422);
      }

      if (action === "twists") {
        if (!adapterForBookType(book.book_type).isFiction) return json({ error: "Plot twists are for fiction only" }, 400);
        const st = normalizeSetup(book.story_setup);
        const alt = st.selectedIndex !== null ? st.alternatives[st.selectedIndex] ?? null : null;
        const n = Math.min(6, Math.max(1, Number(body.count) || 3));
        const pr = buildTwistPrompt(brief, alt, n);
        const r = await runWithRepair(storyCall(mockTwistsOutput(brief, n)), pr, (t) => parseTwists(t, brief.chapterCount));
        return r.ok ? json({ twists: r.value, attempts: r.attempts, engine: storyLive() && !testMode ? "live" : "mock" }) : json({ error: "PLAN_INVALID", issues: r.issues, attempts: r.attempts }, 422);
      }

      if (action === "master") {
        // Phase 4: approved Book Setup feeds the same master planner (planner-only; never canon).
        const setup = normalizeSetup(book.story_setup);
        const sg = setupPlannerGuidance(setup);
        if (book.story_setup && Object.keys(book.story_setup).length) brief.guidance = [brief.guidance, sg.guidance].filter(Boolean).join("\n\n").slice(0, 8000);
        if (!body.alternatives && sg.alternative) { body.alternatives = [sg.alternative]; body.selectedIndex = 0; }
        // Alternatives are optional: with none chosen the master plan is built from the author's own concept.
        if (body.concept && typeof body.concept === "object") {
          const c = body.concept as Partial<NonfictionConcept>;
          const g = conceptGuidance({ id: "c", title: s(c.title, 300), coreThesis: s(c.coreThesis, 1000), approach: s(c.approach, 2000),
            pillars: Array.isArray(c.pillars) ? c.pillars.map((x) => s(x, 300)).slice(0, 8) : [], readerOutcome: s(c.readerOutcome, 1000), summary: "" });
          brief.guidance = [brief.guidance, g].filter(Boolean).join("\n\n").slice(0, 8000);
        }
        const alts: StoryAlternative[] = Array.isArray(body.alternatives) ? body.alternatives.slice(0, 10).map((a: any, i: number) => ({
          id: `alt${i + 1}`, title: s(a?.title, 300), logline: s(a?.logline, 1000), summary: s(a?.summary, 8000), twist: s(a?.twist, 2000), ending: s(a?.ending, 2000),
        })) : [];
        const chosen = Number.isInteger(body.selectedIndex) ? alts[body.selectedIndex] ?? null : null;
        const r = await runWithRepair(call, buildMasterPrompt(brief, chosen), (t) => parseMaster(t, brief, chosen));
        if (!r.ok) return json({ error: "PLAN_INVALID", issues: r.issues, attempts: r.attempts }, 422);
        const v = r.value!;
        const idem = planIdemKey(["master", bookId, s(body.requestId, 100) || crypto.randomUUID()]);
        const { data, error } = await db.rpc("save_master_plan_draft", {
          p_book_id: bookId, p_user_id: userId, p_idem: idem, p_adapter: v.skeleton.adapter, p_premise: v.premise, p_synopsis: v.synopsis,
          p_ending: v.ending, p_genre_data: v.skeleton.genreData, p_reveals: v.skeleton.reveals, p_alternatives: alts, p_skeleton: v.skeleton,
        });
        if (error) throw new Error(error.message);
        return json({ masterPlan: data, attempts: r.attempts, chapters: v.skeleton.chapters.length });
      }

      // Stages below operate on a saved master plan.
      if (!UUID.test(String(body.masterPlanId))) return json({ error: "Invalid masterPlanId" }, 400);
      const { data: mp } = await db.from("book_master_plans").select("*").eq("id", body.masterPlanId).eq("book_id", bookId).eq("user_id", userId).maybeSingle();
      if (!mp || !["DRAFT", "APPROVED"].includes(mp.status) || !mp.plan_skeleton) return json({ error: "Master plan not usable" }, 409);
      const m: MasterContext = { premise: mp.premise, synopsis: mp.master_synopsis, ending: mp.intended_ending, skeleton: mp.plan_skeleton as MasterPlanSkeleton };
      const { data: rows } = await db.from("book_progressive_plans").select("id, plan_level, chapter_index, subsection_index, content, plan_status")
        .eq("master_plan_id", mp.id).in("plan_status", ["PLANNED", "READY"]);
      const latest = (level: string, ch: number) => (rows ?? []).filter((r) => r.plan_level === level && r.chapter_index === ch)
        .sort((a, b) => (a.plan_status === "READY" ? -1 : 1) - (b.plan_status === "READY" ? -1 : 1));
      const expanded: Record<number, ChapterPlan> = {};
      for (const r of rows ?? []) if (r.plan_level === "CHAPTER" && !expanded[r.chapter_index]) expanded[r.chapter_index] = latest("CHAPTER", r.chapter_index)[0].content.chapter;
      const n = m.skeleton.chapters.length;
      const chArg = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? (v as number) : null);

      if (action === "chapters") {
        const list: number[] = Array.isArray(body.chapters) ? body.chapters.map(chArg).filter((x: number | null): x is number => x !== null) : [...Array(n).keys()];
        const runId = s(body.requestId, 100) || "default";
        if (dryRun) {
          const first = list.find((c) => !expanded[c] || body.force === true);
          return json({ dryRun: true, prompts: first === undefined ? [] : [buildChapterPrompt(m, first, expanded)] });
        }
        const out = await runChapterBatch(list, (ch) => !!expanded[ch] && body.force !== true, async (ch) => {
          const r = await runWithRepair(call, buildChapterPrompt(m, ch, expanded), (t) => parseChapter(t, m, ch, expanded));
          if (!r.ok) return { ok: false, issues: r.issues };
          const { error } = await db.rpc("save_progressive_plan_batch", {
            p_book_id: bookId, p_user_id: userId, p_master_plan_id: mp.id, p_idem: planIdemKey(["chapter", mp.id, ch, runId]),
            p_items: [{ plan_level: "CHAPTER", chapter_index: ch, content: r.value, dependencies: r.value!.chapter.dependsOn }],
          });
          if (error) return { ok: false, issues: [error.message] };
          expanded[ch] = r.value!.chapter; // checkpoint: later chapters see it
          return { ok: true, issues: [] };
        });
        return json(out, out.failed ? 207 : 200);
      }

      const ch = chArg(body.chapter);
      if (ch === null) return json({ error: "Invalid chapter" }, 400);
      const chapter = expanded[ch];
      if (!chapter) return json({ error: "Expand this chapter first" }, 409);
      const runId = s(body.requestId, 100) || "default";

      if (action === "sections") {
        const r = await runWithRepair(call, buildSectionPrompt(m, chapter, expanded), (t) => parseSections(t, m, chapter));
        if (!r.ok) return json({ error: "PLAN_INVALID", issues: r.issues, attempts: r.attempts }, 422);
        const items = r.value!.map((d) => { const sec = chapter.sections.find((x) => x.id === d.id)!; return { plan_level: "SECTION", chapter_index: ch, subsection_index: sec.sectionIndex, content: { section: sec, detail: d }, dependencies: sec.dependsOn }; });
        const { data, error } = await db.rpc("save_progressive_plan_batch", { p_book_id: bookId, p_user_id: userId, p_master_plan_id: mp.id, p_idem: planIdemKey(["sections", mp.id, ch, runId]), p_items: items });
        if (error) throw new Error(error.message);
        return json({ saved: data, attempts: r.attempts });
      }

      if (action === "beats") {
        const secRows = latest("SECTION", ch);
        const details = chapter.sections.map((sec) => secRows.find((r) => r.subsection_index === sec.sectionIndex)?.content?.detail).filter(Boolean);
        if (details.length !== chapter.sections.length) return json({ error: "Plan this chapter's sections first" }, 409);
        const r = await runWithRepair(call, buildBeatsPrompt(m, chapter, details, expanded), (t) => parseBeats(t, m, chapter));
        if (!r.ok) return json({ error: "PLAN_INVALID", issues: r.issues, attempts: r.attempts }, 422);
        const items = r.value!.chapter.sections.map((sec) => ({ plan_level: "BEATS", chapter_index: ch, subsection_index: sec.sectionIndex,
          content: { beats: sec.beats, notes: r.value!.notes.filter((x) => x.id.startsWith(`${sec.id}b`)) }, dependencies: [] }));
        const { data, error } = await db.rpc("save_progressive_plan_batch", { p_book_id: bookId, p_user_id: userId, p_master_plan_id: mp.id, p_idem: planIdemKey(["beats", mp.id, ch, runId]), p_items: items });
        if (error) throw new Error(error.message);
        return json({ saved: data, attempts: r.attempts });
      }
      return json({ error: "Invalid action" }, 400);
    } catch (e) {
      if (e instanceof DryRunStop) return json({ dryRun: true, prompts });
      throw e;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("plan-book error:", msg);
    return json({ error: msg }, statusForAIError(e) || 500);
  }
});

class DryRunStop extends Error { constructor() { super("dry run"); } }
void STORY_ALTERNATIVE_COUNTS;
