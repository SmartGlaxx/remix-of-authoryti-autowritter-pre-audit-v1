// Client for the owner-only review service. All writes are performed server-side.
import { supabase } from "@/integrations/supabase/client";

export async function callReview<T = any>(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: T }> {
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/candidate-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function callPlanBook<T = any>(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: T }> {
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/plan-book`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: res.status === 504 ? "Planning took too long. Please try again." : "Unexpected response" }));
  // Long AI actions are kept alive by streaming; their real status arrives in the body.
  if (data && typeof data.__status === "number") {
    const status = data.__status; delete data.__status;
    return { ok: status >= 200 && status < 300, status, data };
  }
  return { ok: res.ok, status: res.status, data };
}

export type SectionOutcome = { state: "accepted"; text: string | null } | { state: "held"; candidateId: string } | { state: "pending" } | { state: "timeout" };

/**
 * Progressive books validate after the text streams. Wait for the server's verdict so a held
 * draft never lands in the page's copy of the book.
 */
export async function awaitSectionOutcome(bookId: string, chapter: number, subsection: number, since: string, timeoutMs = 240_000): Promise<SectionOutcome> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = await callReview<SectionOutcome>({ action: "section_status", bookId, chapter, subsection, since });
    if (r.ok && r.data.state !== "pending") return r.data;
    await new Promise((res) => setTimeout(res, 3000));
  }
  // Still validating server-side: the draft is safe; the caller must pause, never regenerate.
  return { state: "timeout" };
}

/** Before writing a progressive section, see whether an earlier run already produced an outcome. */
export async function priorSectionOutcome(bookId: string, chapter: number, subsection: number): Promise<SectionOutcome> {
  const r = await callReview<SectionOutcome>({ action: "section_status", bookId, chapter, subsection, since: "1970-01-01T00:00:00.000Z" });
  return r.ok ? r.data : { state: "pending" };
}

export const isProgressiveBook = (controls: unknown) => (controls as Record<string, unknown> | null)?.planning_pipeline === "progressive";

/**
 * Accept a held draft. Unsaved edits are persisted first as a new candidate version, then the
 * full server pre-acceptance + fenced pipeline runs on that latest saved version only.
 */
export async function saveThenAccept(bookId: string, candidateId: string, draftText: string, editedText?: string, replaceAccepted = false) {
  let id = candidateId;
  if (editedText !== undefined && editedText.trim() && editedText.trim() !== draftText.trim()) {
    const s = await callReview<{ candidate_id?: string; error?: string }>({ action: "save_edit", bookId, candidateId, editedText });
    if (!s.ok || !s.data.candidate_id) throw new Error(s.data.error ?? "Could not save your edit");
    id = s.data.candidate_id;
  }
  const r = await callReview<any>({ action: "accept", bookId, candidateId: id, replaceAccepted });
  return { ...r, candidateId: id };
}
