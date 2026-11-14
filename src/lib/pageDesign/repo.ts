import { supabase } from "@/integrations/supabase/client";
import { validateSettings, validateSpec } from "../../../supabase/functions/_shared/pageDesign/validate";
import type { BookDesignSettings, PageCompositionSpec } from "@/types/pageDesign";

export const BOOK_SETTINGS_KEY = "__book__";
export interface StoredDesigns { settings: BookDesignSettings | null; pages: Map<string, { spec: PageCompositionSpec; generated: PageCompositionSpec | null }>; rejected: string[] }

/** Owner-isolated by row-level security (user_id = signed-in user AND they own the book). */
export async function loadDesigns(bookId: string): Promise<StoredDesigns> {
  const { data, error } = await supabase.from("page_designs").select("page_key, spec, generated_spec").eq("book_id", bookId);
  if (error) throw error;
  const pages = new Map(); let settings: BookDesignSettings | null = null; const rejected: string[] = [];
  for (const row of data ?? []) {
    if (row.page_key === BOOK_SETTINGS_KEY) { const v = validateSettings(row.spec); if (v.ok) settings = v.value!; else rejected.push(row.page_key); continue; }
    const v = validateSpec(row.spec);
    if (!v.ok) { rejected.push(row.page_key); continue; }
    const g = row.generated_spec ? validateSpec(row.generated_spec) : null;
    pages.set(row.page_key, { spec: v.value!, generated: g?.ok ? g.value! : null });
  }
  return { settings, pages, rejected };
}

async function upsert(bookId: string, pageKey: string, spec: unknown, generated?: unknown) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to save page designs");
  const row: Record<string, unknown> = { user_id: u.user.id, book_id: bookId, page_key: pageKey, spec, schema_version: 2 };
  if (generated !== undefined) row.generated_spec = generated;
  const { error } = await supabase.from("page_designs").upsert(row as never, { onConflict: "book_id,page_key" });
  if (error) throw error;
}

export async function savePageSpec(bookId: string, spec: PageCompositionSpec, generated?: PageCompositionSpec) {
  const v = validateSpec(spec); if (!v.ok) throw new Error(`Design not saved: ${v.errors.join("; ")}`);
  await upsert(bookId, spec.pageKey, spec, generated);
}
export async function saveSettings(bookId: string, s: BookDesignSettings) {
  const v = validateSettings(s); if (!v.ok) throw new Error(`Settings not saved: ${v.errors.join("; ")}`);
  await upsert(bookId, BOOK_SETTINGS_KEY, s);
}
export async function deletePageSpec(bookId: string, pageKey: string) {
  const { error } = await supabase.from("page_designs").delete().eq("book_id", bookId).eq("page_key", pageKey); if (error) throw error;
}
