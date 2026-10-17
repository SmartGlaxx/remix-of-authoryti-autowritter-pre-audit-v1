import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Book } from "@/types/book";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("@/lib/aiLimit", () => ({ isAiBlocked: () => false, detectAiBlock: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useBookGeneration } from "@/hooks/useBookGeneration";

const makeBook = (id: string) => ({
  id, status: "paused", controls: { automationLevel: "assisted", imageGeneration: false },
  outline: { chapters: [{ title: "Chapter One", status: "completed", subsections: [
    { status: "completed", content: "Saved prose remains unchanged.", summary: "Existing summary" },
  ] }] },
} as Book);

describe("Book-aware optional summaries", () => {
  beforeEach(() => invoke.mockReset());

  it("sends the current book id so the server can resolve its saved summarizer model", async () => {
    invoke.mockResolvedValue({ data: { summary: "Summary" }, error: null });
    const { result, rerender } = renderHook(({ book }) => useBookGeneration(book, { onUpdateBook: vi.fn() }), {
      initialProps: { book: makeBook("73247209-19a7-449c-809f-77935b881552") },
    });
    await act(async () => { await result.current.generateChapter(0); });
    expect(invoke).toHaveBeenLastCalledWith("summarize-content", { body: {
      bookId: "73247209-19a7-449c-809f-77935b881552", content: "Saved prose remains unchanged.\n\n", type: "chapter",
    } });
    rerender({ book: makeBook("next-book") });
    await act(async () => { await result.current.generateChapter(0); });
    expect(invoke.mock.lastCall?.[1].body.bookId).toBe("next-book");
  });

  it("an insufficient-credit summary failure does not reject writing or leave progress stuck", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "HTTP 402", context: new Response(
      JSON.stringify({ error: "Google Gemini: insufficient credits" }), { status: 402 },
    ) } });
    const onUpdateBook = vi.fn();
    const { result } = renderHook(() => useBookGeneration(makeBook("current-book"), { onUpdateBook }));
    await act(async () => { await result.current.generateChapter(0); });
    expect(result.current.state.phase).toBe("idle");
    expect(result.current.state.error).toBeNull();
    const finalOutline = onUpdateBook.mock.lastCall?.[1].outline;
    expect(finalOutline.chapters[0].subsections[0].content).toBe("Saved prose remains unchanged.");
  });
});