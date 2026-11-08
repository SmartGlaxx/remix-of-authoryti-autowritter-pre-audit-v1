import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { runNarrativeExtraction } from "@/lib/narrativeExtraction";
import { isAiBlocked, detectAiBlock } from "@/lib/aiLimit";
import { runContinuityCheck, type ContinuityResult } from "@/lib/continuityCheck";

/** Fast draft is the default; "studio" keeps the full deep-check path after every section. */
const isFastDraft = (controls: unknown) =>
  (controls as { writingSpeed?: string } | undefined)?.writingSpeed !== "studio";

/** Polls the extraction ledger until the section's story memory is actually recorded (or gives up). */
async function waitForExtractionSettled(bookId: string, ch: number, sub: number, maxMs = 90_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const { data } = await supabase.from("narrative_extractions").select("status")
      .eq("book_id", bookId).eq("chapter_index", ch).eq("subsection_index", sub)
      .order("updated_at", { ascending: false }).limit(1);
    const s = data?.[0]?.status;
    if (s === "completed") return true;
    if (s === "failed") return false;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}
import { awaitSectionOutcome, isProgressiveBook, priorSectionOutcome } from "@/lib/candidateReview";

/** Applies a continuity result (revised text + status) to one section of an outline. */
function applyContinuityResult(outline: BookOutline, chIdx: number, subIdx: number, r: ContinuityResult): BookOutline {
  const chapters = [...outline.chapters];
  const ch = chapters[chIdx];
  if (!ch) return outline;
  const subs = [...ch.subsections];
  const sub = subs[subIdx];
  if (!sub) return outline;
  subs[subIdx] = {
    ...sub,
    content: r.revised && r.finalText ? r.finalText : sub.content,
    continuity: { status: r.status, checkId: r.checkId, issueCount: r.issueCount },
  };
  chapters[chIdx] = { ...ch, subsections: subs };
  return { ...outline, chapters };
}
import { Book, BookOutline, Chapter, Subsection, CharacterReference, getIELTSBandForAudience, AutomationLevel } from "@/types/book";
import { toast } from "sonner";

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 2000;

const MAX_CONTEXT_CHARS = 2500;
const MAX_SUMMARY_CHARS = 1200;
const MAX_ANCHOR_CHARS = 600;

function trimContext(text?: string, maxChars: number = MAX_CONTEXT_CHARS): string | undefined {
  if (!text) return undefined;
  return text.length <= maxChars ? text : text.slice(-maxChars);
}

function getGenerationChapterSlice(bookData: Book, chapterIndex: number) {
  const chapter = bookData.outline?.chapters?.[chapterIndex];
  if (!chapter) return [];

  return [{
    chapterNumber: chapter.chapterNumber,
    title: chapter.title,
    summary: trimContext(chapter.summary, MAX_SUMMARY_CHARS),
    subsections: chapter.subsections.map((subsection) => ({
      title: subsection.title,
      goal: subsection.goal,
      imageOpportunity: subsection.imageOpportunity,
      status: subsection.status,
    })),
  }];
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries: number = MAX_RETRIES,
  onRetry?: (attempt: number, error: Error) => void
): Promise<T> {
  let lastError: Error;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries) {
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
        onRetry?.(attempt, lastError);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError!;
}

export type GenerationPhase = 
  | "idle" 
  | "planning" 
  | "generating-outline"
  | "generating-characters"
  | "writing"
  | "generating-image"
  | "summarizing"
  | "completed"
  | "paused"
  | "awaiting-approval"
  | "error";

export interface ApprovalRequest {
  type: "outline" | "chapter" | "section";
  title: string;
  chapterIndex?: number;
  subsectionIndex?: number;
}

export interface GenerationState {
  phase: GenerationPhase;
  currentChapter: number;
  currentSubsection: number;
  totalChapters: number;
  totalSubsections: number;
  streamingContent: string;
  currentImage: string | null;
  error: string | null;
  characters: CharacterReference[];
  characterProgress: { current: number; total: number };
  approvalRequest: ApprovalRequest | null;
}

interface UseBookGenerationOptions {
  onUpdateBook: (id: string, updates: Partial<Book>) => void;
  onActivityRecorded?: (words: number, credits: number) => void;
}

export function useBookGeneration(book: Book, options: UseBookGenerationOptions) {
  const { onUpdateBook, onActivityRecorded } = options;
  const [state, setState] = useState<GenerationState>({
    phase: "idle",
    currentChapter: 0,
    currentSubsection: 0,
    totalChapters: 0,
    totalSubsections: 0,
    streamingContent: "",
    currentImage: null,
    error: null,
    characters: [],
    characterProgress: { current: 0, total: 0 },
    approvalRequest: null,
  });
  
  const abortRef = useRef(false);
  const [autoNextChapter, setAutoNextChapter] = useState<number | null>(null);
  const pauseRef = useRef(false);
  const approvalRef = useRef<(() => void) | null>(null);
  const approvalResolveRef = useRef<(() => void) | null>(null);

  const automationLevel: AutomationLevel = book.controls?.automationLevel || "guided";

  // Wait for user approval
  const waitForApproval = useCallback((request: ApprovalRequest): Promise<void> => {
    return new Promise((resolve) => {
      setState(s => ({ ...s, phase: "awaiting-approval", approvalRequest: request }));
      approvalResolveRef.current = resolve;
    });
  }, []);

  // User approves the current gate
  const approveAndContinue = useCallback(() => {
    setState(s => ({ ...s, phase: "writing", approvalRequest: null }));
    if (approvalResolveRef.current) {
      approvalResolveRef.current();
      approvalResolveRef.current = null;
    }
  }, []);

  const generateOutline = useCallback(async (): Promise<BookOutline | null> => {
    setState(s => ({ ...s, phase: "generating-outline", error: null }));
    const ieltsBand = getIELTSBandForAudience(book.audience);
    
    try {
      const { data, error } = await supabase.functions.invoke("generate-outline", {
        body: { book, ieltsBand },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      const outline = data.outline as BookOutline;
      const totalSubs = outline.chapters.reduce((acc, ch) => acc + ch.subsections.length, 0);
      
      setState(s => ({
        ...s,
        totalChapters: outline.chapters.length,
        totalSubsections: totalSubs,
      }));

      onUpdateBook(book.id, { 
        outline,
        status: "ready_to_write",
      });

      return outline;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate outline";
      setState(s => ({ ...s, phase: "error", error: message }));
      toast.error(message);
      return null;
    }
  }, [book, onUpdateBook]);

  const generateCharacters = useCallback(async (outline: BookOutline): Promise<CharacterReference[]> => {
    setState(s => ({ ...s, phase: "generating-characters", characterProgress: { current: 0, total: 0 } }));
    toast.info("Generating character profiles...");

    const ieltsBand = getIELTSBandForAudience(book.audience);

    try {
      const { data, error } = await supabase.functions.invoke("generate-characters", {
        // Send only what the character extractor reads — never written prose or images (keeps it under the size limit).
        body: {
          book: { id: (book as any).id, title: book.title, theme: String((book as any).theme ?? "").slice(0, 2000), bookType: (book as any).bookType, audience: (book as any).audience },
          outline: { chapters: (outline?.chapters ?? []).map((ch: any) => ({ title: ch.title, summary: String(ch.summary ?? "").slice(0, 1200), subsections: (ch.subsections ?? []).map((s: any) => ({ title: s.title, goal: String(s.goal ?? "").slice(0, 400) })) })) },
          ieltsBand,
        },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      const characters = data.characters as CharacterReference[];
      const visualStyleGuide = data.visualStyleGuide as string;

      setState(s => ({ 
        ...s, 
        characters,
        characterProgress: { current: characters.length, total: characters.length }
      }));

      const updatedOutline = { ...outline, characters, visualStyleGuide };
      onUpdateBook(book.id, { outline: updatedOutline });
      
      toast.success(`Generated ${characters.length} character portrait(s)`);
      return characters;
    } catch (err) {
      console.error("Character generation failed:", err);
      toast.error("Character portraits could not be generated, continuing with text descriptions");
      return [];
    }
  }, [book, onUpdateBook]);

  const streamContent = useCallback(async (
    bookData: Book,
    chapterIndex: number,
    subsectionIndex: number,
    previousSummary?: string,
    previousRawContent?: string
  ): Promise<string> => {
    setState(s => ({ 
      ...s, 
      phase: "writing",
      currentChapter: chapterIndex,
      currentSubsection: subsectionIndex,
      streamingContent: "",
    }));

    const ieltsBand = getIELTSBandForAudience(bookData.audience);
    const totalSubsections = bookData.outline?.chapters?.reduce(
      (sum: number, ch: any) => sum + (ch.subsections?.length || 0), 0
    ) || 1;
    const targetWordCount = bookData.controls?.structureControls?.targetWordCount || 50000;
    const targetWordsPerSubsection = Math.round(targetWordCount / totalSubsections);
    const clampedWordsPerSubsection = Math.max(300, Math.min(1200, targetWordsPerSubsection));

    // Mode-based word limits
    let effectiveWordsPerSubsection: number;
    if (automationLevel === "guided") {
      // Guided: 2-3 sentences only (~50-80 words)
      effectiveWordsPerSubsection = 80;
    } else if (automationLevel === "assisted") {
      // Assisted: 1 paragraph (~150-250 words)
      effectiveWordsPerSubsection = Math.min(250, clampedWordsPerSubsection);
    } else {
      effectiveWordsPerSubsection = clampedWordsPerSubsection;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.access_token;
    
    if (!accessToken) {
      throw new Error("Session expired. Please refresh the page and try again.");
    }

    const strippedBook = {
      id: bookData.id,
      title: bookData.title,
      subtitle: bookData.subtitle,
      bookType: bookData.bookType,
      theme: bookData.theme,
      genre: bookData.genre,
      audience: bookData.audience,
      pov: bookData.pov,
      toneProfile: bookData.toneProfile,
      controls: bookData.controls,
      outline: {
        chapters: getGenerationChapterSlice(bookData, chapterIndex),
      },
    };

    const payload = {
      book: strippedBook,
      chapterIndex: 0,
      absoluteChapterIndex: chapterIndex,
      subsectionIndex,
      previousSummary: trimContext(previousSummary, MAX_SUMMARY_CHARS),
      previousRawContent: trimContext(previousRawContent),
      tonalAnchors: (bookData.tonalAnchors || []).slice(-2).map((anchor) => trimContext(anchor, MAX_ANCHOR_CHARS) || "").filter(Boolean),
      ieltsBand,
      targetWordsPerSubsection: effectiveWordsPerSubsection,
      teaserStyle: bookData.controls?.teaserStyle || "none",
      automationLevel,
      aiModel: localStorage.getItem("authoryti_ai_model") || "deepseek-reasoner",
    };

    const payloadJson = JSON.stringify(payload);
    const payloadSize = new TextEncoder().encode(payloadJson).length;
    console.log(`[BookGen] Payload size: ${(payloadSize / 1024).toFixed(1)}KB`);

    if (payloadSize > 180_000) {
      console.warn(`[BookGen] Payload dangerously large, stripping further...`);
      payload.previousRawContent = payload.previousRawContent?.slice(-500);
      payload.tonalAnchors = payload.tonalAnchors?.slice(-1).map(a => a?.slice(0, 200) || "");
    }

    const send = () => fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-content`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify(payload),
    });
    // Progressive books: make sure the previous accepted section's story memory is updated
    // before asking to write the next one (the server refuses otherwise).
    const prevPos = (() => {
      if (subsectionIndex > 0) return { c: chapterIndex, s: subsectionIndex - 1 };
      for (let c = chapterIndex - 1; c >= 0; c--) {
        const n = bookData.outline?.chapters?.[c]?.subsections?.length ?? 0;
        if (n > 0) return { c, s: n - 1 };
      }
      return null;
    })();
    if (prevPos && bookData.id && (bookData.controls as { planning_pipeline?: string } | undefined)?.planning_pipeline === "progressive") {
      const { data: acc } = await supabase.from("book_section_acceptances")
        .select("extraction_status, manuscript_status").eq("book_id", bookData.id)
        .eq("chapter_index", prevPos.c).eq("subsection_index", prevPos.s);
      const live = (acc ?? []).filter((r) => r.manuscript_status !== "REVISED");
      let needsMemory = live.length > 0 && live.every((r) => r.extraction_status !== "EXTRACTED");
      if (!live.length) {
        // Older sections without an acceptance record: the extraction ledger decides (as on the server).
        const { data: ex } = await supabase.from("narrative_extractions").select("status")
          .eq("book_id", bookData.id).eq("chapter_index", prevPos.c).eq("subsection_index", prevPos.s)
          .order("updated_at", { ascending: false }).limit(1);
        needsMemory = ex?.[0]?.status !== "completed";
      }
      if (needsMemory) {
        // Idempotent: if an update is already running, this waits/retries until it completes.
        await runNarrativeExtraction(bookData.id, prevPos.c, prevPos.s, { timeoutMs: 120_000, attempts: 5 });
        // A background update may still be finishing — wait for the ledger before asking to write.
        await waitForExtractionSettled(bookData.id, prevPos.c, prevPos.s);
      }
    }

    // Progressive books: a serious contradiction in an earlier section needs the author's decision first.
    if (bookData.id && (bookData.controls as { planning_pipeline?: string } | undefined)?.planning_pipeline === "progressive") {
      const { data: pending } = await supabase.from("canon_reconciliation_logs")
        .select("chapter_index, subsection_index, dedup_key").eq("book_id", bookData.id)
        .eq("decision", "PENDING").in("severity", ["CRITICAL", "MAJOR"]).limit(50);
      const here = chapterIndex * 1000 + subsectionIndex;
      const blocking = (pending ?? []).filter((l) => !String(l.dedup_key ?? "").startsWith("selftest_") && l.chapter_index * 1000 + l.subsection_index < here);
      if (blocking.length) {
        window.dispatchEvent(new Event("canon-reconciliation-changed"));
        throw new Error("A story contradiction needs your decision first — see the red card above the chapters.");
      }
    }

    // Returns the saved text once an in-progress write of this section finishes; null if none was saved.
    const waitForExistingWrite = async (): Promise<string | null> => {
      if (!bookData.id) return null;
      const started = Date.now();
      while (Date.now() - started < 180_000) {
        const { data: lease } = await supabase.from("book_generation_leases").select("status, expires_at")
          .eq("book_id", bookData.id).eq("chapter_index", chapterIndex).eq("subsection_index", subsectionIndex)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        const busy = lease?.status === "ACTIVE" && new Date(lease.expires_at).getTime() > Date.now();
        if (!busy) break;
        await new Promise((r) => setTimeout(r, 5000));
      }
      if (Date.now() - started < 1000) return null; // nothing was in progress
      const { data: row } = await supabase.from("books").select("outline").eq("id", bookData.id).maybeSingle();
      const text = (row?.outline as { chapters?: { subsections?: { content?: string }[] }[] } | null)
        ?.chapters?.[chapterIndex]?.subsections?.[subsectionIndex]?.content;
      if (text && text.trim()) { setState((st) => ({ ...st, streamingContent: text })); return text; }
      return null;
    };

    // Avoid a refused request: if this section is already being written, wait for it instead.
    const alreadySaved = await waitForExistingWrite();
    if (alreadySaved) return alreadySaved;

    let response = await send();

    // Self-heal: the previous accepted section's story memory was never updated. Update it, then retry.
    // Extraction can still be finishing when the first retry lands, so allow a few rounds.
    for (let round = 0; round < 4 && response.status === 409; round++) {
      const errBody = await response.clone().json().catch(() => ({}));
      if (errBody?.code !== "RECOVER_EXTRACTION" || !bookData.id || !prevPos) break;
      const r = await runNarrativeExtraction(bookData.id, prevPos.c, prevPos.s, { timeoutMs: 120_000, attempts: 4 });
      if (r.status !== "completed" && r.status !== "skipped") continue;
      await waitForExtractionSettled(bookData.id, prevPos.c, prevPos.s);
      response = await send();
    }

    // The same section is still being written by an earlier request (e.g. after a dropped connection).
    // Don't start a second paid write: wait for that one to save, then use its text.
    if (response.status === 409 && bookData.id) {
      const errBody = await response.clone().json().catch(() => ({}));
      if (errBody?.code === "LEASE_HELD") {
        const saved = await waitForExistingWrite();
        if (saved) return saved;
        response = await send();
      }
    }

    // Just-in-time blueprint: the app builds and approves this chapter's blueprint itself, then retries.
    if (response.status === 409 && bookData.id) {
      const problem = await response.clone().json().catch(()=>({}));
      if (problem.code === 'CHARACTER_REFERENCES_REQUIRED') {
        setState(st=>({...st,phase:'generating-characters'}));
        const {data,error} = await supabase.functions.invoke('generate-characters',{body:{book:{id:bookData.id,title:bookData.title},outline:{},ieltsBand}});
        if(error || !data?.characters) throw new Error(data?.error ?? 'Character references could not be completed.');
        setState(st=>({...st,phase:'writing'}));
        response = await send();
      }
    }
    if (response.status === 409 && bookData.id) {
      const errBody = await response.clone().json().catch(() => ({}));
      if (errBody?.code === "BLUEPRINT_REQUIRED") {
        const { ensureChapterBlueprint } = await import("@/lib/autoBlueprint");
        await ensureChapterBlueprint(bookData.id, chapterIndex);
        response = await send();
      }
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const msg = errorData.error || `Error: ${response.status}`;
      if (errorData?.code === "RECOVER_EXTRACTION") {
        throw new Error("Story memory for the previous section is still updating. Wait a moment, then press the write button again — nothing has been lost.");
      }
      if (response.status === 402) {
        throw new Error(msg.includes("Daily") ? "Daily word limit reached for your plan. It resets at midnight UTC, or upgrade to keep writing now" : `Credit limit reached: ${msg}. Please upgrade your plan.`);
      }
      throw new Error(msg);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        if (!line.startsWith("data: ")) continue;

        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") break;

        let parsed: any;
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          buffer = line + "\n" + buffer;
          break;
        }
        if (parsed?.error) throw new Error(String(parsed.error));
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          fullContent += content;
          setState(s => ({ ...s, streamingContent: fullContent }));
        }
      }

      if (abortRef.current) break;
    }

    console.log(`[BookGen] Content received: ${fullContent.split(/\s+/).length} words`);
    return fullContent;
  }, [automationLevel]);

  const generateImage = useCallback(async (
    content: string,
    imageOpportunity?: string,
    characters?: CharacterReference[],
    visualStyleGuide?: string
  ): Promise<string | null> => {
    if (!book.controls.imageGeneration) return null;
    setState(s => ({ ...s, phase: "generating-image", currentImage: null }));

    try {
      const { data, error } = await supabase.functions.invoke("generate-image", {
        body: {
          content,
          bookType: book.bookType,
          theme: book.theme,
          imageOpportunity,
          characters,
          visualStyleGuide,
          useCharacterReferences: characters && characters.length > 0,
        },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);
      setState(s => ({ ...s, currentImage: data.imageUrl }));
      return data.imageUrl;
    } catch (err) {
      console.error("Image generation failed:", err);
      return null;
    }
  }, [book]);

  const summarizeContent = useCallback(async (
    content: string,
    type: "subsection" | "chapter"
  ): Promise<string> => {
    // Nothing to summarize (e.g. empty chapter) — skip instead of sending an invalid request.
    if (!content || !content.trim() || isAiBlocked()) return "";
    setState(s => ({ ...s, phase: "summarizing" }));

    try {
      const { data, error } = await supabase.functions.invoke("summarize-content", {
        body: { bookId: book.id, content, type },
      });
      if (error) throw error;
      return data?.summary || "";
    } catch (err) {
      // Summaries are optional context; a failure (e.g. AI limit reached) must not break the page.
      detectAiBlock((err as any)?.context ? await (err as any).context.text?.().catch(() => "") : String(err));
      console.warn("Summarization skipped:", err instanceof Error ? err.message : err);
      return "";
    } finally {
      // Restore writing progress without overriding an explicit pause/stop/error.
      setState(s => s.phase === "summarizing" ? { ...s, phase: "writing" } : s);
    }
  }, [book.id]);

  const startGeneration = useCallback(async () => {
    abortRef.current = false;
    pauseRef.current = false;

    console.log("[BookGen] Starting generation:", book.title, "| Mode:", automationLevel);

    let currentBook = book;
    let outline = book.outline;
    let characters: CharacterReference[] = book.outline?.characters || [];
    let visualStyleGuide = book.outline?.visualStyleGuide || "";

    // Phase 1: Generate outline if needed
    if (!outline || outline.chapters.length === 0) {
      setState(s => ({ ...s, phase: "planning" }));
      onUpdateBook(book.id, { status: "planning" });
      
      outline = await generateOutline();
      if (!outline) return;
      
      currentBook = { ...currentBook, outline };

      // Approval gate after outline (all modes except auto-draft)
      if (automationLevel !== "auto-draft") {
        await waitForApproval({
          type: "outline",
          title: `${outline.chapters.length} chapters planned`,
        });
        if (abortRef.current) return;
      }
    }

    // Phase 1.5: Generate characters
    const isChildrensBook = book.bookType === "children" || book.bookType === "comic";
    if (!outline.characters || outline.characters.length === 0) {
      characters = await generateCharacters(outline);
      visualStyleGuide = outline.visualStyleGuide || "";
      outline = { ...outline, characters, visualStyleGuide };
      currentBook = { ...currentBook, outline };
    } else {
      characters = outline.characters;
      visualStyleGuide = outline.visualStyleGuide || "";
    }

    // Phase 2: Write content
    onUpdateBook(book.id, { status: "writing" });

    let previousSummary = "";
    let previousRawContent = "";
    let tonalAnchors: string[] = [...(book.tonalAnchors || [])];
    let subsectionCounter = 0;

    for (let chIdx = book.currentChapterIndex; chIdx < outline.chapters.length; chIdx++) {
      if (abortRef.current) break;
      
      const chapter = outline.chapters[chIdx];
      const updatedSubsections: Subsection[] = [...chapter.subsections];
      let chapterContent = "";

      const startSubIdx = chIdx === book.currentChapterIndex ? book.currentSubsectionIndex : 0;

      for (let subIdx = startSubIdx; subIdx < chapter.subsections.length; subIdx++) {
        if (abortRef.current) break;
        while (pauseRef.current) {
          await new Promise(r => setTimeout(r, 500));
          if (abortRef.current) break;
        }

        const subsection = chapter.subsections[subIdx];
        // Already written: never rewrite (the server protects accepted sections anyway).
        if (subsection.status === "completed" || (subsection.content && subsection.content.trim())) {
          chapterContent += (subsection.content || "") + "\n\n";
          previousSummary = subsection.summary || previousSummary;
          previousRawContent = (subsection.content || "").split(/\s+/).slice(-1000).join(" ");
          continue;
        }
        subsectionCounter++;
        setState(s => ({ ...s, phase: "writing", streamingContent: "", currentChapter: chIdx, currentSubsection: subIdx, totalChapters: outline!.chapters.length, totalSubsections: outline!.chapters.reduce((n, c) => n + c.subsections.length, 0) }));
        onUpdateBook(book.id, { status: "writing", currentChapterIndex: chIdx, currentSubsectionIndex: subIdx });

        try {
          const startedAt = new Date(Date.now() - 5000).toISOString();
          // Progressive: never write a section twice. A held draft waits for review; an accepted one is reused.
          const prior = isProgressiveBook(book.controls) && !subsection.content ? await priorSectionOutcome(book.id, chIdx, subIdx) : { state: "pending" as const };
          if (prior.state === "held") throw new Error("a draft is held for your review — see the note at the top of this page to resolve it, then writing will resume");
          let content = prior.state === "accepted" && prior.text ? prior.text : await retryWithBackoff(
            () => streamContent(
              { ...currentBook, outline, tonalAnchors },
              chIdx,
              subIdx,
              previousSummary,
              previousRawContent
            ),
            MAX_RETRIES,
            (attempt, error) => {
              toast.warning(`Content generation failed (attempt ${attempt}/${MAX_RETRIES}), retrying...`);
            }
          );
          // Progressive Planning: only the server-accepted text is kept; a held draft waits for the author.
          if (isProgressiveBook(book.controls)) {
            const outcome = prior.state === "accepted" && prior.text ? prior : await awaitSectionOutcome(book.id, chIdx, subIdx, startedAt);
            if (outcome.state === "timeout") throw new Error("checks on this section are still running; your draft is saved — open Planning Studio to see its status before continuing");
            if (outcome.state === "held") throw new Error("a draft is held for your review — see the note at the top of this page to resolve it, then writing will resume");
            if (outcome.state === "pending") throw new Error("checks on this section did not finish; open Planning Studio to review");
            if (outcome.text) content = outcome.text;
          }

          chapterContent += content + "\n\n";
          const wordCount = content.split(/\s+/).length;

          // Record activity for streak tracking
          onActivityRecorded?.(wordCount, Math.ceil(wordCount / 1000));

          // Image generation
          let imageUrl: string | null = null;
          if (isChildrensBook || (book.controls.imageGeneration && subsectionCounter % 3 === 0)) {
            try {
              imageUrl = await retryWithBackoff(
                () => generateImage(content, subsection.imageOpportunity, characters, visualStyleGuide),
                2,
              );
            } catch (imgErr) {
              console.warn("Image generation failed after retries:", imgErr);
            }
          }

          // Summarize
          let summary = "";
          try {
            summary = await retryWithBackoff(
              () => summarizeContent(content, "subsection"),
              MAX_RETRIES,
            );
          } catch (sumErr) {
            summary = content.slice(0, 500) + "...";
          }
          
          previousSummary = summary;
          const words = content.split(/\s+/);
          previousRawContent = words.slice(-Math.min(1000, words.length)).join(" ");

          // Tonal anchor extraction
          if (Math.random() < 0.3 && content.length > 200) {
            const paragraphs = content.split(/\n\n+/).filter(p => p.length > 100);
            if (paragraphs.length > 0) {
              const randomPara = paragraphs[Math.floor(Math.random() * paragraphs.length)];
              tonalAnchors = [...tonalAnchors.slice(-2), randomPara];
            }
          }

          // Strip any leftover meta-labels the model might still emit
          const cleanContent = content
            .replace(/\[\/?(?:TEASER|HOOK|SCENE|BEAT|NOTE)\]/gi, "")
            .replace(/^\s*(?:Hook|Teaser|Scene|Beat|Note)\s*:\s*/gim, "")
            .trim();

          // Update subsection
          updatedSubsections[subIdx] = {
            ...subsection,
            content: cleanContent,
            summary,
            teaser: undefined,
            imageUrl: imageUrl || undefined,
            status: "completed",
          };

          // Save progress
          const updatedChapters = [...outline.chapters];
          updatedChapters[chIdx] = {
            ...chapter,
            subsections: updatedSubsections,
            status: subIdx === chapter.subsections.length - 1 ? "completed" : "writing",
          };

          const newOutline = { ...outline, chapters: updatedChapters };
          outline = newOutline;
          currentBook = { 
            ...currentBook, 
            outline: newOutline,
            tonalAnchors,
            currentChapterIndex: chIdx,
            currentSubsectionIndex: subIdx + 1,
            wordCount: (currentBook.wordCount || 0) + wordCount,
          };

          await retryWithBackoff(
            async () => {
              onUpdateBook(book.id, {
                outline: newOutline,
                tonalAnchors,
                currentChapterIndex: chIdx,
                currentSubsectionIndex: subIdx + 1,
                wordCount: currentBook.wordCount,
              });
            },
            MAX_RETRIES,
          );

          // Narrative memory: record what this section established. Non-blocking on failure.
          if (isProgressiveBook(book.controls) && isFastDraft(book.controls)) {
            // Fast draft: the server's pre-acceptance gate already validated this section
            // before it was saved, so the client re-check is redundant. Story memory updates
            // in the background — the next section's preflight waits for it if needed.
            void runNarrativeExtraction(book.id, chIdx, subIdx, { timeoutMs: 180_000, attempts: 5 });
          } else {
            // Pass 4: continuity check (+ bounded revision) BEFORE extraction, so only the
            // accepted final text ever reaches narrative state.
            const cont = await runContinuityCheck(book.id, chIdx, subIdx);
            outline = applyContinuityResult(outline, chIdx, subIdx, cont);
            updatedSubsections[subIdx] = outline.chapters[chIdx].subsections[subIdx];
            currentBook = { ...currentBook, outline };
            if (cont.revised && cont.finalText) {
              const w = cont.finalText.split(/\s+/);
              previousRawContent = w.slice(-Math.min(1000, w.length)).join(" ");
            }
            onUpdateBook(book.id, { outline });
            if (cont.status === "NEEDS_REVIEW") toast.warning(`Continuity: ${subsection.title} needs your review`);

            // Unresolved contradictions must not become story memory until the author decides.
            if (cont.status !== "NEEDS_REVIEW" || isProgressiveBook(book.controls)) await runNarrativeExtraction(book.id, chIdx, subIdx);
          }

          // APPROVAL GATES based on automation level
          if (automationLevel === "guided") {
            // Guided: approval after every section
            await waitForApproval({
              type: "section",
              title: subsection.title,
              chapterIndex: chIdx,
              subsectionIndex: subIdx,
            });
            if (abortRef.current) return;
          } else if (automationLevel === "assisted") {
            // Assisted: approval every 2-3 sections (batch)
            if ((subIdx + 1) % 2 === 0 || subIdx === chapter.subsections.length - 1) {
              await waitForApproval({
                type: "section",
                title: `Sections ${Math.max(1, subIdx)}–${subIdx + 1} of ${chapter.title}`,
                chapterIndex: chIdx,
                subsectionIndex: subIdx,
              });
              if (abortRef.current) return;
            }
          }
          // semi-auto: waits at chapter level (below)
          // auto-draft: no waiting

        } catch (err) {
          const message = err instanceof Error ? err.message : "Generation failed";
          setState(s => ({ ...s, phase: "error", error: message }));
          toast.error(`Generation stopped: ${message}. No chapters were skipped.`);
          const pausedChapters = outline.chapters.map((ch, ci) => ci !== chIdx ? ch : {
            ...ch,
            status: ch.status === "writing" ? "pending" as const : ch.status,
            subsections: ch.subsections.map((sub, si) => si === subIdx && sub.status === "writing" ? { ...sub, status: "pending" as const } : sub),
          });
          outline = { ...outline, chapters: pausedChapters };
          window.dispatchEvent(new Event("candidate-drafts-changed"));
          try {
            await retryWithBackoff(async () => {
              onUpdateBook(book.id, {
                outline,
                status: "paused",
                currentChapterIndex: chIdx,
                currentSubsectionIndex: subIdx,
              });
            }, MAX_RETRIES);
          } catch (saveErr) {
            console.error("Failed to save pause state:", saveErr);
          }
          return;
        }
      }

      // Chapter completed
      if (!abortRef.current) {
        const chapterSummary = await summarizeContent(chapterContent, "chapter");
        
        const updatedChapters = [...outline.chapters];
        updatedChapters[chIdx] = {
          ...updatedChapters[chIdx],
          summary: chapterSummary,
          status: "completed",
        };

        outline = { ...outline, chapters: updatedChapters };
        onUpdateBook(book.id, { outline });

        // Semi-auto: approval after each chapter
        if (automationLevel === "semi-auto" && chIdx < outline.chapters.length - 1) {
          await waitForApproval({
            type: "chapter",
            title: chapter.title,
            chapterIndex: chIdx,
          });
          if (abortRef.current) return;
        }
      }
    }

    // All done
    if (!abortRef.current) {
      setState(s => ({ ...s, phase: "completed" }));
      onUpdateBook(book.id, { status: "completed" });
      toast.success("Book generation completed!");
    }
  }, [book, automationLevel, generateOutline, generateCharacters, streamContent, generateImage, summarizeContent, onUpdateBook, waitForApproval, onActivityRecorded]);

  const pauseGeneration = useCallback(() => {
    pauseRef.current = true;
    setState(s => ({ ...s, phase: "paused" }));
    onUpdateBook(book.id, { status: "paused" });
  }, [book.id, onUpdateBook]);

  const resumeGeneration = useCallback(() => {
    pauseRef.current = false;
    startGeneration();
  }, [startGeneration]);

  const stopGeneration = useCallback(() => {
    abortRef.current = true;
    pauseRef.current = false;
    setState(s => ({ ...s, phase: "idle", approvalRequest: null }));
    onUpdateBook(book.id, { status: "paused" });
  }, [book.id, onUpdateBook]);

  // Generate only outline (co-pilot: separate action)
  const generateOutlineOnly = useCallback(async () => {
    abortRef.current = false;
    setState(s => ({ ...s, phase: "planning" }));
    onUpdateBook(book.id, { status: "planning" });
    
    const outline = await generateOutline();
    if (outline) {
      // Also generate characters
      const isChildrensBook = book.bookType === "children" || book.bookType === "comic";
      if (!outline.characters || outline.characters.length === 0) {
        await generateCharacters(outline);
      }
      setState(s => ({ ...s, phase: "idle" }));
      toast.success("Outline generated! Review and start writing chapter by chapter.");
    }
  }, [book, generateOutline, generateCharacters, onUpdateBook]);

  // Generate a single chapter (co-pilot)
  const generateChapter = useCallback(async (chapterIndex: number) => {
    abortRef.current = false;
    pauseRef.current = false;

    let currentBook = book;
    let outline = book.outline;
    if (!outline) return;

    const characters = outline.characters || [];
    const visualStyleGuide = outline.visualStyleGuide || "";
    const isChildrensBook = book.bookType === "children" || book.bookType === "comic";

    onUpdateBook(book.id, { status: "writing" });

    const chapter = outline.chapters[chapterIndex];
    if (!chapter) return;

    const updatedSubsections: Subsection[] = [...chapter.subsections];
    let chapterContent = "";
    let previousSummary = "";
    let previousRawContent = "";
    let tonalAnchors: string[] = [...(book.tonalAnchors || [])];
    let subsectionCounter = 0;

    for (let subIdx = 0; subIdx < chapter.subsections.length; subIdx++) {
      if (abortRef.current) break;
      while (pauseRef.current) {
        await new Promise(r => setTimeout(r, 500));
        if (abortRef.current) break;
      }

      const subsection = chapter.subsections[subIdx];
      if (subsection.status === "completed") {
        chapterContent += (subsection.content || "") + "\n\n";
        previousSummary = subsection.summary || "";
        previousRawContent = subsection.content || "";
        continue;
      }
      if (subsection.content && subsection.content.trim()) {
        chapterContent += subsection.content + "\n\n";
        previousSummary = subsection.summary || previousSummary;
        previousRawContent = subsection.content.split(/\s+/).slice(-1000).join(" ");
        continue;
      }
      subsectionCounter++;
      // Show exactly which section is being written.
      setState(s => ({ ...s, phase: "writing", streamingContent: "", currentChapter: chapterIndex, currentSubsection: subIdx, totalChapters: outline!.chapters.length, totalSubsections: outline!.chapters.reduce((n, c) => n + c.subsections.length, 0) }));
      {
        const chs = [...outline.chapters];
        const subs = [...chs[chapterIndex].subsections];
        subs[subIdx] = { ...subs[subIdx], status: "writing" };
        chs[chapterIndex] = { ...chs[chapterIndex], subsections: subs, status: "writing" };
        outline = { ...outline, chapters: chs };
        onUpdateBook(book.id, { outline, status: "writing", currentChapterIndex: chapterIndex, currentSubsectionIndex: subIdx });
      }

      try {
        const startedAt = new Date(Date.now() - 5000).toISOString();
        const progressiveBook = isProgressiveBook(book.controls);
        // Progressive: never write a section twice. A held draft waits for review; an accepted one is reused.
        const prior = progressiveBook && !subsection.content ? await priorSectionOutcome(book.id, chapterIndex, subIdx) : { state: "pending" as const };
        if (prior.state === "held") throw new Error("a draft is held for your review — see the note at the top of this page to resolve it, then writing will resume");
        let content = prior.state === "accepted" && prior.text ? prior.text : await retryWithBackoff(
          () => streamContent(
            { ...currentBook, outline, tonalAnchors },
            chapterIndex,
            subIdx,
            previousSummary,
            previousRawContent
          ),
          MAX_RETRIES,
        );
        // Progressive: wait for the server's checks to accept the section before moving on,
        // so the next section never starts before this one is accepted and remembered.
        if (progressiveBook) {
          const outcome = prior.state === "accepted" && prior.text ? prior : await awaitSectionOutcome(book.id, chapterIndex, subIdx, startedAt);
          if (outcome.state === "timeout") throw new Error("checks on this section are still running; your draft is saved — try again in a minute");
          if (outcome.state === "held") throw new Error("a draft is held for your review — see the note at the top of this page to resolve it, then writing will resume");
          if (outcome.state === "pending") throw new Error("checks on this section did not finish; try again shortly");
          if (outcome.text) content = outcome.text;
        }

        chapterContent += content + "\n\n";
        const wordCount = content.split(/\s+/).length;
        onActivityRecorded?.(wordCount, Math.ceil(wordCount / 1000));

        let imageUrl: string | null = null;
        if (isChildrensBook || (book.controls.imageGeneration && subsectionCounter % 3 === 0)) {
          try {
            imageUrl = await retryWithBackoff(
              () => generateImage(content, subsection.imageOpportunity, characters, visualStyleGuide),
              2,
            );
          } catch {}
        }

        let summary = "";
        try {
          summary = await retryWithBackoff(() => summarizeContent(content, "subsection"), MAX_RETRIES);
        } catch { summary = content.slice(0, 500) + "..."; }

        previousSummary = summary;
        const words = content.split(/\s+/);
        previousRawContent = words.slice(-Math.min(1000, words.length)).join(" ");

        if (Math.random() < 0.3 && content.length > 200) {
          const paragraphs = content.split(/\n\n+/).filter(p => p.length > 100);
          if (paragraphs.length > 0) {
            tonalAnchors = [...tonalAnchors.slice(-2), paragraphs[Math.floor(Math.random() * paragraphs.length)]];
          }
        }

        const cleanContent = content
          .replace(/\[\/?(?:TEASER|HOOK|SCENE|BEAT|NOTE)\]/gi, "")
          .replace(/^\s*(?:Hook|Teaser|Scene|Beat|Note)\s*:\s*/gim, "")
          .trim();

        updatedSubsections[subIdx] = {
          ...subsection,
          content: cleanContent,
          summary,
          teaser: undefined,
          imageUrl: imageUrl || undefined,
          status: "completed",
        };

        const updatedChapters = [...outline.chapters];
        updatedChapters[chapterIndex] = {
          ...chapter,
          subsections: updatedSubsections,
          status: subIdx === chapter.subsections.length - 1 ? "completed" : "writing",
        };

        const newOutline = { ...outline, chapters: updatedChapters };
        outline = newOutline;
        currentBook = {
          ...currentBook,
          outline: newOutline,
          tonalAnchors,
          currentChapterIndex: chapterIndex,
          currentSubsectionIndex: subIdx + 1,
          wordCount: (currentBook.wordCount || 0) + wordCount,
        };

        onUpdateBook(book.id, {
          outline: newOutline,
          tonalAnchors,
          currentChapterIndex: chapterIndex,
          currentSubsectionIndex: subIdx + 1,
          wordCount: currentBook.wordCount,
        });

        // Narrative memory: record what this section established. Non-blocking on failure.
        if (isProgressiveBook(book.controls) && isFastDraft(book.controls)) {
          // Fast draft: server-side pre-acceptance already validated this section; story
          // memory updates in the background and the next section's preflight waits for it.
          void runNarrativeExtraction(book.id, chapterIndex, subIdx, { timeoutMs: 180_000, attempts: 5 });
        } else {
          // Pass 4: continuity check (+ bounded revision) BEFORE extraction, so only the
          // accepted final text ever reaches narrative state.
          const cont = await runContinuityCheck(book.id, chapterIndex, subIdx);
          outline = applyContinuityResult(outline, chapterIndex, subIdx, cont);
          updatedSubsections[subIdx] = outline.chapters[chapterIndex].subsections[subIdx];
          currentBook = { ...currentBook, outline };
          if (cont.revised && cont.finalText) {
            const w = cont.finalText.split(/\s+/);
            previousRawContent = w.slice(-Math.min(1000, w.length)).join(" ");
          }
          onUpdateBook(book.id, { outline });
          if (cont.status === "NEEDS_REVIEW") toast.warning(`Continuity: ${subsection.title} needs your review`);

          // Unresolved contradictions must not become story memory until the author decides.
          if (cont.status !== "NEEDS_REVIEW" || isProgressiveBook(book.controls)) await runNarrativeExtraction(book.id, chapterIndex, subIdx);
        }

        // In guided mode, pause after each section
        if (automationLevel === "guided") {
          await waitForApproval({
            type: "section",
            title: subsection.title,
            chapterIndex,
            subsectionIndex: subIdx,
          });
          if (abortRef.current) return;
        }

      } catch (err) {
        const message = err instanceof Error ? err.message : "Generation failed";
        setState(s => ({ ...s, phase: "error", error: message }));
        toast.error(`Generation stopped: ${message}`);
        // Clear the "writing" spinner on this section so its card (or held-draft review) shows again.
        const chs = [...outline.chapters];
        const subs = [...chs[chapterIndex].subsections];
        if (subs[subIdx]?.status === "writing") subs[subIdx] = { ...subs[subIdx], status: "pending" };
        chs[chapterIndex] = { ...chs[chapterIndex], subsections: subs };
        outline = { ...outline, chapters: chs };
        if (/held for your review/.test(message)) window.dispatchEvent(new Event("candidate-drafts-changed"));
        onUpdateBook(book.id, { outline, status: "paused", currentChapterIndex: chapterIndex, currentSubsectionIndex: subIdx });
        return;
      }
    }

    // Chapter complete
    if (!abortRef.current) {
      const chapterSummary = await summarizeContent(chapterContent, "chapter");
      const updatedChapters = [...outline.chapters];
      updatedChapters[chapterIndex] = { ...updatedChapters[chapterIndex], summary: chapterSummary, status: "completed" };
      outline = { ...outline, chapters: updatedChapters };
      onUpdateBook(book.id, { outline, status: book.status });
      setState(s => ({ ...s, phase: "idle" }));
      toast.success(`Chapter "${chapter.title}" completed!`);
      // Auto Draft: move straight on to the next chapter, no approval.
      if (automationLevel === "auto-draft" && chapterIndex < outline.chapters.length - 1) {
        setAutoNextChapter(chapterIndex + 1);
      }
    }
  }, [book, automationLevel, streamContent, generateImage, summarizeContent, onUpdateBook, waitForApproval, onActivityRecorded]);

  // Kick off the queued Auto Draft chapter once the finished one is saved into `book`.
  useEffect(() => {
    if (autoNextChapter === null || abortRef.current) return;
    const prev = book.outline?.chapters?.[autoNextChapter - 1];
    if (prev?.status !== "completed") return;
    const next = autoNextChapter;
    setAutoNextChapter(null);
    generateChapter(next);
  }, [autoNextChapter, book, generateChapter]);

  return {
    state,
    startGeneration,
    pauseGeneration,
    resumeGeneration,
    stopGeneration,
    generateOutline: generateOutlineOnly,
    generateCharacters,
    generateChapter,
    approveAndContinue,
  };
}
