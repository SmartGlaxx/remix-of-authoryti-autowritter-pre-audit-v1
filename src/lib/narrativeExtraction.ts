// Client trigger for post-generation story-state extraction.
// Never throws and never blocks longer than `timeoutMs`: prose generation must not
// depend on the narrative-memory subsystem.
import { supabase } from "@/integrations/supabase/client";
import { reportError } from "@/lib/errorReporter";
import { waitForSavedProse } from "@/lib/continuityCheck";
import { isAiBlocked, detectAiBlock } from "@/lib/aiLimit";

export type ExtractionResult = { status: string; [k: string]: unknown };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callOnce(bookId: string, chapterIndex: number, subsectionIndex: number): Promise<{ http: number; body: ExtractionResult }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { http: 401, body: { status: "failed", error: "Not signed in" } };
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-narrative-state`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
    body: JSON.stringify({ bookId, chapterIndex, subsectionIndex }),
  });
  const body = (await res.json().catch(() => ({ status: "failed", error: `HTTP ${res.status}` }))) as ExtractionResult;
  return { http: res.status, body };
}

/** Runs extraction with retries (409 = section not saved yet, 5xx = transient). Safe to call repeatedly. */
export async function runNarrativeExtraction(bookId: string, chapterIndex: number, subsectionIndex: number, opts: { timeoutMs?: number; attempts?: number } = {}): Promise<ExtractionResult> {
  const attempts = opts.attempts ?? 3;
  if (isAiBlocked()) return { status: "skipped", error: "ai_blocked" };
  const work = (async (): Promise<ExtractionResult> => {
    // Never request extraction for a section whose prose isn't saved (avoids 409 no_prose).
    if (!(await waitForSavedProse(bookId, chapterIndex, subsectionIndex))) return { status: "no_prose" };
    let last: ExtractionResult = { status: "failed", error: "not attempted" };
    for (let i = 0; i < attempts; i++) {
      try {
        const { http, body } = await callOnce(bookId, chapterIndex, subsectionIndex);
        last = body;
        if (http === 200) return body;
        if (detectAiBlock(body?.error)) return { status: "skipped", error: "ai_blocked" };
        if (http !== 409 && http < 500) break; // auth/validation — retrying won't help
      } catch (e) {
        last = { status: "failed", error: e instanceof Error ? e.message : String(e) };
      }
      await sleep(1500 * 2 ** i);
    }
    return last;
  })();
  const timeout = new Promise<ExtractionResult>((r) => setTimeout(() => r({ status: "timeout" }), opts.timeoutMs ?? 60_000));
  const result = await Promise.race([work, timeout]).catch((e) => ({ status: "failed", error: String(e) }));
  if (result.status === "failed") {
    void reportError(`Narrative extraction failed: ${String(result.error ?? "")}`, { context: { bookId, chapterIndex, subsectionIndex } });
  }
  return result;
}
