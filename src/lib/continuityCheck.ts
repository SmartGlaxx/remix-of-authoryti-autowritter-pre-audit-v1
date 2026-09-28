// Client trigger for the Pass 4 continuity check. Never throws; on any failure the
// section is kept as written and marked CHECK_FAILED (never reported as clean).
import { supabase } from "@/integrations/supabase/client";
import { reportError } from "@/lib/errorReporter";

export type ContinuityStatus = "PASSED" | "PASSED_WITH_WARNINGS" | "REVISED" | "NEEDS_REVIEW" | "CHECK_FAILED";
export interface ContinuityResult {
  status: ContinuityStatus;
  checkId?: string;
  revised?: boolean;
  finalText?: string;
  issueCount?: number;
  warningCount?: number;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The section save is fire-and-forget; wait until the completed prose is actually in the database. */
export async function waitForSavedProse(bookId: string, ch: number, sub: number, maxMs = 20_000): Promise<boolean> {
  const start = Date.now();
  let delay = 300;
  while (Date.now() - start < maxMs) {
    const { data } = await supabase.from("books").select("outline").eq("id", bookId).maybeSingle();
    const s = (data?.outline as any)?.chapters?.[ch]?.subsections?.[sub];
    if (s?.status === "completed" && typeof s.content === "string" && s.content.trim()) return true;
    await sleep(delay);
    delay = Math.min(delay * 2, 2000);
  }
  return false;
}

export async function runContinuityCheck(bookId: string, chapterIndex: number, subsectionIndex: number, opts: { timeoutMs?: number } = {}): Promise<ContinuityResult> {
  const work = (async (): Promise<ContinuityResult> => {
    // Never ask the server to check a section whose prose isn't saved (or is empty).
    if (!(await waitForSavedProse(bookId, chapterIndex, subsectionIndex))) {
      return { status: "CHECK_FAILED", error: "no_prose" };
    }
    let last: ContinuityResult = { status: "CHECK_FAILED", error: "not attempted" };
    for (let i = 0; i < 3; i++) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return { status: "CHECK_FAILED", error: "Not signed in" };
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-continuity`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
          body: JSON.stringify({ bookId, chapterIndex, subsectionIndex }),
        });
        const body = await res.json().catch(() => ({ status: "CHECK_FAILED", error: `HTTP ${res.status}` }));
        if (res.ok) return body as ContinuityResult;
        last = { status: "CHECK_FAILED", error: body?.error ?? `HTTP ${res.status}` };
        if (res.status !== 409 && res.status < 500) break;
      } catch (e) {
        last = { status: "CHECK_FAILED", error: e instanceof Error ? e.message : String(e) };
      }
      await sleep(1500 * 2 ** i);
    }
    return last;
  })();
  const timeout = new Promise<ContinuityResult>((r) => setTimeout(() => r({ status: "CHECK_FAILED", error: "timeout" }), opts.timeoutMs ?? 300_000));
  const result = await Promise.race([work, timeout]);
  if (result.status === "CHECK_FAILED") void reportError(`Continuity check failed: ${result.error ?? ""}`, { context: { bookId, chapterIndex, subsectionIndex } });
  return result;
}
