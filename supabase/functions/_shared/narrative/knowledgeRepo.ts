// Phase 3: persists character knowledge for one accepted, freshly extracted section (service client).
// Rollback: rows from an older text of the same section are removed first. Retries are idempotent
// through deterministic dedup keys. Ambiguous holders go to knowledge_identity_reviews, never guessed.
import { planKnowledgeWrites, type ExtractedKnowledge } from "./knowledge.ts";
import { planCastIdentities } from "./castIdentities.ts";

/** Gives every planned cast member of this book a knowledge identity (book-scoped matches only),
 *  so planned characters are never queued as "Characters to confirm". Best-effort, idempotent. */
// deno-lint-ignore no-explicit-any
export async function ensureCastIdentities(db: any, userId: string, bookId: string, universeId: string | null): Promise<{ created: number; linked: number }> {
  const { data: cast } = await db.from("story_characters").select("id, name, aliases, narrative_identity_id").eq("book_id", bookId).eq("user_id", userId).eq("is_active", true);
  if (!cast?.length || !cast.some((c: any) => !c.narrative_identity_id)) return { created: 0, linked: 0 };
  let q = db.from("narrative_identities").select("id, display_name, aliases, universe_id").eq("user_id", userId).eq("origin_book_id", bookId).is("merged_into_id", null);
  q = universeId ? q.eq("universe_id", universeId) : q.is("universe_id", null);
  const { data: own } = await q;
  const plan = planCastIdentities(cast, (own ?? []).map((r: any) => ({ id: r.id, displayName: r.display_name, aliases: r.aliases ?? [], universeId: r.universe_id })));
  const ids = new Map<string, string>();
  for (const c of plan.create) {
    const { data, error } = await db.from("narrative_identities").insert({ user_id: userId, universe_id: universeId, display_name: c.displayName, aliases: c.aliases, level: "story_character", kind: "person", origin_book_id: bookId, seed_details: {} }).select("id").single();
    if (error) throw new Error(`cast identity failed: ${error.message}`);
    ids.set(c.key, data.id);
  }
  let linked = 0;
  for (const l of plan.links) {
    const id = ids.get(l.target) ?? l.target;
    const { error } = await db.from("story_characters").update({ narrative_identity_id: id }).eq("id", l.castId).is("narrative_identity_id", null);
    if (!error) linked++;
  }
  return { created: plan.create.length, linked };
}
import type { KnownIdentity } from "./identityResolution.ts";
import type { StoryPosition } from "./rules.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

/** Knowledge tracking is on only for books tied to a universe, a narrator persona or the progressive pipeline. */
// deno-lint-ignore no-explicit-any
export function knowledgeEnabled(book: { universe_id?: string | null; narrator_identity_id?: string | null; controls?: any } | null | undefined): boolean {
  return !!book && (!!book.universe_id || !!book.narrator_identity_id || book.controls?.planning_pipeline === "progressive");
}

export async function loadIdentitiesFor(db: Db, userId: string, universeId: string | null): Promise<KnownIdentity[]> {
  let q = db.from("narrative_identities").select("id, display_name, aliases, universe_id").eq("user_id", userId).is("merged_into_id", null).limit(5000);
  q = universeId ? q.eq("universe_id", universeId) : q.is("universe_id", null);
  const { data } = await q;
  return (data ?? []).map((r: Record<string, any>) => ({ id: r.id, displayName: r.display_name, aliases: r.aliases ?? [], universeId: r.universe_id }));
}

export async function syncKnowledgeForSection(db: Db, o: {
  bookId: string; userId: string; universeId: string | null; pos: StoryPosition; extractionId: string; contentHash: string;
  items: ExtractedKnowledge[]; sectionDate?: string | null; nonLinear?: boolean;
}) {
  const sectionKey = `${o.pos.chapterIndex}:${o.pos.subsectionIndex}`;
  // Rollback derived knowledge from older texts of this section (accepted prose itself is never touched).
  await db.from("knowledge_acquisitions").delete().eq("book_id", o.bookId).eq("source_section_key", sectionKey).neq("content_hash", o.contentHash);
  await db.from("knowledge_identity_reviews").delete().eq("book_id", o.bookId).eq("source_section_key", sectionKey).eq("status", "PENDING").neq("content_hash", o.contentHash);

  await ensureCastIdentities(db, o.userId, o.bookId, o.universeId);
  const identities = await loadIdentitiesFor(db, o.userId, o.universeId);
  const plan = planKnowledgeWrites(o.items, { identities, universeId: o.universeId, bookId: o.bookId, chapterIndex: o.pos.chapterIndex, subsectionIndex: o.pos.subsectionIndex, contentHash: o.contentHash, sectionDate: o.sectionDate, nonLinear: o.nonLinear });

  if (plan.rows.length) {
    const { error } = await db.from("knowledge_acquisitions").upsert(plan.rows.map((r) => ({
      user_id: o.userId, book_id: o.bookId, universe_id: o.universeId, identity_id: r.identity_id, claim: r.claim, source: r.source,
      source_identity_id: r.source_identity_id, certainty: r.certainty, learned_date: r.learned_date, learned_chapter_index: r.learned_chapter_index,
      learned_subsection_index: r.learned_subsection_index, knowledge_kind: r.knowledge_kind, truth_status: r.truth_status, evidence: r.evidence,
      scene_point: r.scene_point, extraction_id: o.extractionId, source_section_key: sectionKey, content_hash: o.contentHash, dedup_key: r.dedup_key,
    })), { onConflict: "dedup_key", ignoreDuplicates: true });
    if (error) throw new Error(`knowledge write failed: ${error.message}`);
  }
  if (plan.reviews.length) {
    const { error } = await db.from("knowledge_identity_reviews").upsert(plan.reviews.map((r) => ({
      user_id: o.userId, book_id: o.bookId, source_section_key: sectionKey, content_hash: o.contentHash, character_name: r.character_name,
      reason: r.reason, candidate_identity_ids: r.candidate_identity_ids, payload: r.payload, dedup_key: r.dedup_key,
    })), { onConflict: "dedup_key", ignoreDuplicates: true });
    if (error) throw new Error(`knowledge review write failed: ${error.message}`);
  }
  return { status: "ok", recorded: plan.rows.length, heldForReview: plan.reviews.length };
}

// ── Generation-time loading (progressive books with a narrator identity) ──
import { knowledgeCandidates, narratorBoundaries, parseStoryDate, scenePoint, type EvalNarration, type LifeRecord } from "./knowledge.ts";
import type { ApproximateDate, NarrativeVantage } from "./chronology.ts";
import type { ContextCandidate } from "./adaptiveContext.ts";

export interface NarratorContext { candidates: ContextCandidate[]; narration: EvalNarration; lifeRecords: LifeRecord[]; sceneDate: ApproximateDate | null }

/**
 * Scene date comes from the section plan (storyDate / isFlashback) when present. Without a date the
 * manuscript position is used only for linear scenes; flashbacks without dates stay "unclear".
 */
// deno-lint-ignore no-explicit-any
export async function loadNarratorContext(db: Db, bookId: string, userId: string, pos: StoryPosition, sectionPlan?: any): Promise<NarratorContext | null> {
  const { data: b } = await db.from("books").select("narrator_identity_id, narrative_vantage, narrator_telling_date, universe_id, controls").eq("id", bookId).eq("user_id", userId).maybeSingle();
  if (!b?.narrator_identity_id) return null;
  const [{ data: ident }, { data: rows }, { data: personas }] = await Promise.all([
    db.from("narrative_identities").select("id, display_name").eq("id", b.narrator_identity_id).eq("user_id", userId).maybeSingle(),
    db.from("knowledge_acquisitions").select("*").eq("user_id", userId).eq("identity_id", b.narrator_identity_id).limit(2000),
    db.from("personas").select("identity_id, birth_date, death_date").eq("user_id", userId).limit(2000),
  ]);
  const ids = await loadIdentitiesFor(db, userId, b.universe_id ?? null);
  const byId = new Map(ids.map((i) => [i.id, i]));
  const sceneDate = (sectionPlan?.storyDate && typeof sectionPlan.storyDate === "object") ? sectionPlan.storyDate as ApproximateDate : parseStoryDate(typeof sectionPlan?.storyDate === "string" ? sectionPlan.storyDate : null);
  const scene = scenePoint({ ...pos, storyDate: sceneDate, nonLinear: sectionPlan?.isFlashback === true || sectionPlan?.nonLinear === true });
  const vantage: NarrativeVantage = b.narrative_vantage === "retrospective" ? "retrospective" : "immediate";
  const telling = b.narrator_telling_date ? { date: b.narrator_telling_date as ApproximateDate } : null;
  const bounds = narratorBoundaries(rows ?? [], b.narrator_identity_id, scene, vantage, telling);
  const name = ident?.display_name ?? "The narrator";
  const pov = String(b.controls?.pointOfView ?? b.controls?.pov ?? "first").toLowerCase();
  return {
    candidates: knowledgeCandidates(bounds, name),
    narration: { vantage, firstPerson: !pov.includes("third"), narratorName: name,
      inScene: bounds.inScene.map((r: Record<string, any>) => r.claim), hindsightOnly: bounds.hindsightOnly.map((r: Record<string, any>) => r.claim),
      notYetKnown: [...bounds.unknown, ...bounds.uncertain].map((r: Record<string, any>) => r.claim) },
    lifeRecords: (personas ?? []).filter((p: Record<string, any>) => byId.has(p.identity_id)).map((p: Record<string, any>) => ({ name: byId.get(p.identity_id)!.displayName, aliases: byId.get(p.identity_id)!.aliases, birth: p.birth_date, death: p.death_date })),
    sceneDate,
  };
}
