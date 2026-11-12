// Phase 2D: persists the identity-sync plan for one accepted section. Server-only (service client).
// Entity creation is idempotent through the resolver (a retry finds them as EXISTING);
// attribute changes go through the transactional, idempotent commit_identity_batch function.
import { planIdentitySync, kindFor, type Proposal } from "./identitySync.ts";
import type { RegistryEntity, VersionedValue } from "./identity.ts";
import type { StoryPosition } from "./rules.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
const fromPos = (p: number): StoryPosition => ({ chapterIndex: Math.floor(p / 10000), subsectionIndex: p % 10000 });

export async function syncIdentityForSection(db: Db, bookId: string, userId: string, pos: StoryPosition, replayRunId?: string) {
  const { data: ext } = await db.from("narrative_extractions").select("id, content_hash, status")
    .eq("book_id", bookId).eq("chapter_index", pos.chapterIndex).eq("subsection_index", pos.subsectionIndex)
    .eq("status", "completed").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!ext) return { status: "skipped", reason: "no accepted extraction" };

  // Regeneration undo: drop generated attribute versions committed from an older text of this section.
  const sectionKey = `${pos.chapterIndex}:${pos.subsectionIndex}`;
  const { data: oldCommits } = await db.from("identity_commits").select("id").eq("book_id", bookId).eq("section_id", sectionKey).neq("content_hash", ext.content_hash);
  if (oldCommits?.length) {
    await db.from("identity_attribute_versions").delete().eq("book_id", bookId).eq("source_section_key", sectionKey).neq("authority", "USER_CANON").in("commit_id", oldCommits.map((c: { id: string }) => c.id));
  }
  const [ents, vers, chars, sents] = await Promise.all([
    db.from("identity_entities").select("*").eq("book_id", bookId).limit(5000),
    db.from("identity_attribute_versions").select("*").eq("book_id", bookId).limit(20000),
    db.from("story_characters").select("id, name, role, source_key, extraction_id").eq("book_id", bookId).limit(5000),
    db.from("story_entities").select("id, name, entity_type, description, first_chapter_index, first_subsection_index").eq("book_id", bookId)
      .eq("first_chapter_index", pos.chapterIndex).eq("first_subsection_index", pos.subsectionIndex).limit(500),
  ]);
  const registry: RegistryEntity[] = (ents.data ?? []).map((e: Record<string, any>) => {
    const history: RegistryEntity["history"] = {};
    for (const v of (vers.data ?? []).filter((x: Record<string, any>) => x.entity_id === e.id)) {
      const k = v.attribute as keyof RegistryEntity["history"];
      (history[k] ??= [] as VersionedValue[]).push({ value: v.value, effectiveAt: fromPos(Number(v.effective_position)), source: v.source, authority: v.authority, evidence: v.evidence, sourceSectionKey: v.source_section_key });
    }
    return { id: e.id, kind: e.kind, name: e.name, aliases: e.aliases ?? [], introducedAt: fromPos(Number(e.introduced_position)), history };
  });

  const proposals: Proposal[] = [];
  for (const c of chars.data ?? []) {
    const outline = !!c.source_key;
    if (!outline && c.extraction_id !== ext.id) continue;
    proposals.push({ key: `char:${c.id}`, name: c.name, kind: "person", attribute: "role", value: c.role ?? null, evidence: outline ? "outline character" : `named in accepted section ${pos.chapterIndex}:${pos.subsectionIndex}`, outline });
  }
  for (const e of sents.data ?? []) {
    proposals.push({ key: `entity:${e.id}`, name: e.name, kind: kindFor(e.entity_type), attribute: "description", value: e.description ?? null, evidence: `introduced in accepted section ${pos.chapterIndex}:${pos.subsectionIndex}`, outline: false });
  }

  const plan = planIdentitySync(registry, proposals, pos);
  const ids = new Map<string, string>();
  for (const c of plan.create) {
    const { data, error } = await db.from("identity_entities").insert({ book_id: bookId, user_id: userId, kind: c.kind, name: c.name, aliases: [], introduced_position: c.introducedPosition }).select("id").single();
    if (error) throw new Error(`identity create failed: ${error.message}`);
    ids.set(c.key, data.id);
  }
  const position = pos.chapterIndex * 10000 + pos.subsectionIndex;
  const changes = plan.changes.map((c) => ({ entity_id: ids.get(c.entity_key) ?? c.entity_key, attribute: c.attribute, value: c.value, authority: c.authority, evidence: c.evidence, source: c.source, position }));
  let commit: unknown = null;
  if (changes.length) {
    const { data, error } = await db.rpc("commit_identity_batch", { p_book_id: bookId, p_user_id: userId, p_section_id: `${pos.chapterIndex}:${pos.subsectionIndex}`, p_content_hash: ext.content_hash, p_purpose: replayRunId ? `audit_replay_${replayRunId}` : "identity_sync", p_schema_version: 1, p_extraction_id: ext.id, p_changes: changes });
    if (error) throw new Error(`identity commit failed: ${error.message}`);
    commit = data;
  }
  return { status: "ok", created: plan.create.length, changes: changes.length, skipped: plan.skipped, commit };
}
