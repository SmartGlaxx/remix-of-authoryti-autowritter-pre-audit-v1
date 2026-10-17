// Stage D I/O: best-effort signal recording. Never throws, never blocks acceptance or writing.
import { resolveWriter } from "./personas.ts";
import type { SignalKind } from "./learning.ts";
import { SIGNAL_WEIGHT } from "./learning.ts";

export async function recordSignals(db: any, rows: { userId: string; bookId: string; controls: unknown; bookType: string; genre?: string | null;
  chapter: number; sub: number; categories: string[]; kind: SignalKind; sourceRef: string; hash?: string | null }): Promise<void> {
  try {
    if (!rows.categories.length) return;
    const writerId = resolveWriter(rows.controls as any, rows.bookType).id;
    const data = [...new Set(rows.categories)].map((category) => ({
      user_id: rows.userId, writer_id: writerId, book_id: rows.bookId, genre: rows.genre ?? null, category, kind: rows.kind,
      weight: SIGNAL_WEIGHT[rows.kind], chapter_index: rows.chapter, subsection_index: rows.sub, source_ref: rows.sourceRef, content_hash: rows.hash ?? null,
    }));
    await db.from("writer_learning_signals").upsert(data, { onConflict: "user_id,source_ref,category,kind", ignoreDuplicates: true });
  } catch (e) { console.warn("[learning] signal skipped:", e instanceof Error ? e.message : e); }
}

/** Categories of open naturalness findings for one section (used to attribute author approvals/rejections). */
export async function sectionFindingCategories(db: any, bookId: string, chapter: number, sub: number): Promise<string[]> {
  try {
    const { data } = await db.from("naturalness_findings").select("category").eq("book_id", bookId).eq("chapter_index", chapter).eq("subsection_index", sub).limit(50);
    return [...new Set((data ?? []).map((r: any) => r.category as string))];
  } catch { return []; }
}
