import { bestParagraph, locate, recommend, targetedRewritePrompt, parseEdits, applyTargetedEdits, discussionPrompt, parseDiscussion, type ChatMsg } from "./conflictReview.ts";
import { contentHash } from "../extraction.ts";
import { createAIDeps, loadBookModelConfig } from "../../ai/server.ts";
import { failClosedDeps, generateAIText } from "../../ai/client.ts";

type Row = Record<string, any>;
type Db = any;
const open = (c: Row) => ["BLOCKED_MATERIAL", "NEEDS_AUTHOR_REVIEW"].includes(c.validation_status);

/** Owner verification is required by the caller before any read or write here. */
export async function conflictStatus(db: Db, bookId: string) {
  const [{ data: book, error: be }, { data: logs, error: le }, { data: candidates }, { data: facts }, { data: anchors }, { data: acceptances }] = await Promise.all([
    db.from("books").select("outline, story_setup").eq("id", bookId).maybeSingle(),
    db.from("canon_reconciliation_logs").select("*").eq("book_id", bookId).order("created_at", { ascending: false }).limit(100),
    db.from("book_candidate_drafts").select("id, parent_candidate_id, chapter_index, subsection_index, draft_text, validation_status, created_at").eq("book_id", bookId).order("created_at", { ascending: false }).limit(200),
    db.from("canonical_facts").select("id, subject, predicate, value, source_chapter_index, source_subsection_index").eq("book_id", bookId).eq("canon_status", "ESTABLISHED").limit(1000),
    db.from("narrative_exact_anchors").select("anchor_key, exact_text, effective_chapter_index, source_type").eq("book_id", bookId).eq("is_active", true).limit(200),
    db.from("book_section_acceptances").select("chapter_index, subsection_index, extraction_status, manuscript_status, content_hash").eq("book_id", bookId).order("created_at", { ascending: false }).limit(1000),
  ]);
  if (be || le) throw new Error(be?.message ?? le?.message);
  const cs: Row[] = candidates ?? [];
  const outline = book?.outline;
  const enriched = (logs ?? []).filter((l: Row) => !String(l.dedup_key ?? "").startsWith("selftest_") && l.application_status !== "ABANDONED" && ["CRITICAL", "MAJOR"].includes(l.severity)).map((l: Row) => {
    const ref = l.canon_reference ?? {};
    const ch = l.chapter_index, sub = l.subsection_index;
    const active = cs.find((c) => c.chapter_index === ch && c.subsection_index === sub && open(c));
    const original = cs.find((c) => c.id === l.candidate_id);
    const text = active?.draft_text ?? original?.draft_text ?? outline?.chapters?.[ch]?.subsections?.[sub]?.content ?? "";
    const newer = bestParagraph(text, l.prose_excerpt);
    const fact = (facts ?? []).find((f: Row) => f.id === ref.source_ref || (ref.entity && f.subject === ref.entity && (!ref.evidence || String(ref.evidence).includes(String(f.value)))));
    const anchor = (anchors ?? []).find((a: Row) => a.anchor_key === ref.anchor_key);
    const priorText = String(ref.evidence ?? ref.expected ?? anchor?.exact_text ?? (fact ? `${fact.subject} ${fact.predicate} ${fact.value}` : ""));
    let priorLocation = null, priorParagraph = "", source: "author" | "accepted_text" | "unknown" = "unknown";
    if (priorText) {
      if (fact && Number.isInteger(fact.source_chapter_index) && Number.isInteger(fact.source_subsection_index)) {
        const p = bestParagraph(outline?.chapters?.[fact.source_chapter_index]?.subsections?.[fact.source_subsection_index]?.content ?? "", priorText);
        priorLocation = locate(outline, fact.source_chapter_index, fact.source_subsection_index, p?.index ?? null);
        priorParagraph = p?.paragraph ?? ""; source = p ? "accepted_text" : "unknown";
      } else {
        // Do not search later text or the conflicting section as evidence for earlier truth.
        outer: for (let c = 0; c <= ch; c++) for (let s = 0; s < (outline?.chapters?.[c]?.subsections?.length ?? 0); s++) {
          if (c === ch && s >= sub) break;
          const p = bestParagraph(outline.chapters[c].subsections[s].content ?? "", priorText);
          if (p) { priorLocation = locate(outline, c, s, p.index); priorParagraph = p.paragraph; source = "accepted_text"; break outer; }
        }
      }
      if (anchor?.source_type === "author" || /USER|AUTHOR|OUTLINE/i.test(String(ref.authority ?? ""))) source = "author";
    }
    const acc = (acceptances ?? []).find((a: Row) => a.chapter_index === ch && a.subsection_index === sub && ["ACCEPTED", "ESTABLISHED"].includes(a.manuscript_status));
    return { ...l, candidate: active ?? null,
      prior: { summary: priorText || "The earlier detail was not recorded with this flag.", paragraph: priorParagraph, location: priorLocation, source },
      newer: { summary: l.prose_excerpt || "The check did not record a specific quotation.", paragraph: newer?.paragraph ?? "", location: locate(outline, ch, sub, newer?.index ?? null), source: active ? "held_draft" : "manuscript" },
      recommendation: source === "unknown" ? { choice: "prior", reason: "The earlier claim has no verified quotation here. Review the recorded fact before choosing; AI correction is unavailable until its source is clear." } : recommend({ severity: l.severity, authority: ref.authority, priorSource: source, priorText, newText: l.prose_excerpt ?? "" }),
      memorySynced: acc?.extraction_status === "EXTRACTED", accepted: Boolean(acc),
    };
  });
  return { logs: enriched };
}

/** Prepare a saved draft before recording a truth choice; never touches accepted prose. */
export async function prepareConflict(db: Db, bookId: string, userId: string, logId: string) {
  const { data: log } = await db.from("canon_reconciliation_logs").select("*").eq("book_id", bookId).eq("id", logId).maybeSingle();
  if (!log || log.decision !== "PENDING") throw new Error("This conflict has already been decided. Refresh to see its current status.");
  const { data: active } = await db.from("book_candidate_drafts").select("*").eq("book_id", bookId).eq("chapter_index", log.chapter_index).eq("subsection_index", log.subsection_index).in("validation_status", ["BLOCKED_MATERIAL", "NEEDS_AUTHOR_REVIEW"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (active) {
    // Only a still-pending record can be attached; evidence and decisions remain immutable.
    if (!log.candidate_id) { const { error } = await db.from("canon_reconciliation_logs").update({ candidate_id: active.id }).eq("id", log.id).eq("decision", "PENDING"); if (error) throw new Error(error.message); }
    return { candidate_id: active.id, draft_text: active.draft_text };
  }
  const { data: book } = await db.from("books").select("outline").eq("id", bookId).maybeSingle();
  const text = book?.outline?.chapters?.[log.chapter_index]?.subsections?.[log.subsection_index]?.content;
  if (!text) throw new Error("The section text could not be found. Open its draft for review.");
  const { data: mp } = await db.from("book_master_plans").select("id").eq("book_id", bookId).eq("status", "APPROVED").order("version", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await db.rpc("save_candidate_draft", { p_book_id: bookId, p_user_id: userId, p_chapter: log.chapter_index, p_sub: log.subsection_index, p_master_plan_id: mp?.id ?? null,
    p_text: text, p_hash: contentHash(text), p_status: "NEEDS_AUTHOR_REVIEW", p_findings: [], p_usage: {}, p_origin: "author_edit", p_parent: null, p_dedup_keys: [log.dedup_key].filter(Boolean) });
  if (error) throw new Error(error.message);
  const { data: saved } = await db.from("book_candidate_drafts").select("validation_status").eq("id", data?.candidate_id).maybeSingle();
  if (!saved) throw new Error("The section draft could not be prepared. Refresh and retry.");
  if (!open(saved)) {
    // Same text was reviewed before: reopen that copy so the correction can run on the current section text.
    const { error: re } = await db.from("book_candidate_drafts").update({ validation_status: "NEEDS_AUTHOR_REVIEW", resolved_at: null }).eq("id", data.candidate_id);
    if (re) throw new Error(re.message);
  }
  const { error: le } = await db.from("canon_reconciliation_logs").update({ candidate_id: data.candidate_id }).eq("id", log.id).eq("decision", "PENDING");
  if (le) throw new Error(le.message);
  return { candidate_id: data.candidate_id, draft_text: text };
}

export async function rewriteConflict(db: Db, bookId: string, userId: string, logId: string, candidateId: string, testMode: boolean) {
  const status = await conflictStatus(db, bookId);
  const log = status.logs.find((l: Row) => l.id === logId);
  if (!log || log.decision !== "KEEP_CANON_REVISE_PROSE") throw new Error("Choose to keep the established detail before requesting a correction.");
  const { data: c } = await db.from("book_candidate_drafts").select("*").eq("book_id", bookId).eq("id", candidateId).maybeSingle();
  if (!c || !open(c) || c.chapter_index !== log.chapter_index || c.subsection_index !== log.subsection_index) throw new Error("Draft no longer open. Refresh before retrying.");
  if (!log.prior.summary || log.prior.source === "unknown") throw new Error("The earlier source is uncertain. Make a manual correction rather than asking AI to guess.");
  const paragraph = bestParagraph(c.draft_text, log.prose_excerpt);
  if (!paragraph) throw new Error("The quoted passage is no longer in this draft. Review and check your latest edit.");
  const { data: allowed, error: rateError } = await db.rpc("check_rate_limit", { _user_id: userId, _function_name: "conflict-rewrite", _max_per_hour: 30, _max_per_day: 100 });
  if (rateError || allowed !== true) throw new Error("Correction limit reached. Try again later.");
  const config = await loadBookModelConfig(db, bookId, userId);
  const deps = createAIDeps(db, userId);
  const r = await generateAIText({ role: "continuity_reviser", config, userId, bookId, maxRetries: 0,
    request: { ...targetedRewritePrompt({ truth: log.prior.summary, conflicting: paragraph.paragraph, description: log.description }), json: true } }, testMode ? failClosedDeps(deps) : deps);
  const patched = applyTargetedEdits(c.draft_text, parseEdits(r.text));
  if (!patched.applied) throw new Error("No safe, targeted correction was returned. Your text is unchanged; try a manual edit.");
  const { data, error } = await db.rpc("save_candidate_draft", { p_book_id: bookId, p_user_id: userId, p_chapter: c.chapter_index, p_sub: c.subsection_index, p_master_plan_id: c.master_plan_id,
    p_text: patched.text, p_hash: contentHash(patched.text), p_status: "NEEDS_AUTHOR_REVIEW", p_findings: [], p_usage: {}, p_origin: "author_edit", p_parent: c.id, p_dedup_keys: [] });
  if (error) throw new Error(error.message);
  return { candidate_id: data.candidate_id, draft_text: patched.text, status: "saved" };
}

/** Chat with the continuity editor about one conflict. Returns a reply plus optional targeted edits; nothing is saved. */
export async function discussConflict(db: Db, bookId: string, userId: string, logId: string, history: ChatMsg[], testMode: boolean) {
  const status = await conflictStatus(db, bookId);
  const log = status.logs.find((l: Row) => l.id === logId);
  if (!log) throw new Error("This conflict could not be found. Refresh the review list.");
  const clean: ChatMsg[] = (Array.isArray(history) ? history : []).slice(-12)
    .filter((m) => m && (m.role === "author" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (!clean.length || clean[clean.length - 1].role !== "author") throw new Error("Send your thought or question first.");
  const { data: allowed, error: rateError } = await db.rpc("check_rate_limit", { _user_id: userId, _function_name: "conflict-discuss", _max_per_hour: 60, _max_per_day: 200 });
  if (rateError || allowed !== true) throw new Error("Discussion limit reached. Try again later.");
  const config = await loadBookModelConfig(db, bookId, userId);
  const deps = createAIDeps(db, userId);
  const r = await generateAIText({ role: "continuity_reviser", config, userId, bookId, maxRetries: 0,
    request: { ...discussionPrompt({ truth: log.prior.summary, conflicting: log.newer.paragraph || log.newer.summary, description: log.description, recommendation: log.recommendation.reason, history: clean }), json: true } }, testMode ? failClosedDeps(deps) : deps);
  const parsed = parseDiscussion(r.text);
  return { reply: parsed.reply, edits: parsed.edits.slice(0, 4) };
}

/** Apply chat-proposed targeted edits to the open candidate (preparing one if needed) and save a new version. */
export async function applyConflictEdits(db: Db, bookId: string, userId: string, logId: string, edits: { find: string; replace: string }[]) {
  const prepared = await prepareConflict(db, bookId, userId, logId);
  const patched = applyTargetedEdits(prepared.draft_text, Array.isArray(edits) ? edits.slice(0, 4) : []);
  if (!patched.applied) throw new Error("The suggested edits no longer match the draft. Ask the editor again or edit manually.");
  const { data: c } = await db.from("book_candidate_drafts").select("*").eq("id", prepared.candidate_id).maybeSingle();
  const { data, error } = await db.rpc("save_candidate_draft", { p_book_id: bookId, p_user_id: userId, p_chapter: c.chapter_index, p_sub: c.subsection_index, p_master_plan_id: c.master_plan_id,
    p_text: patched.text, p_hash: contentHash(patched.text), p_status: "NEEDS_AUTHOR_REVIEW", p_findings: [], p_usage: {}, p_origin: "author_edit", p_parent: c.id, p_dedup_keys: [] });
  if (error) throw new Error(error.message);
  return { candidate_id: data.candidate_id, draft_text: patched.text, status: "saved" };
}