import { describe, it, expect } from "vitest";
import { WRITER_PERSONAS, bestWriterFor, resolveWriter, renderWriterPrompt, genreSpecialistFor } from "../../supabase/functions/_shared/writers/personas";
import { BOOK_TYPE_GENRES } from "../types/book";
describe("Writer personas", () => {
  it("12 unique writers, 6 female / 6 male", () => {
    expect(new Set(WRITER_PERSONAS.map((w) => w.id)).size).toBe(12);
    expect(WRITER_PERSONAS.filter((w) => w.gender === "female")).toHaveLength(6);
  });
  it("covers every requested book type", () => {
    for (const t of ["novel","self-help","finance","business","children","comic","technology","science-popular","cookbook","drama","magazine"])
      expect(WRITER_PERSONAS.some((w) => w.bookTypes.includes(t))).toBe(true);
  });
  it("best fit is sensible", () => {
    expect(bestWriterFor("cookbook").id).toBe("luca"); expect(bestWriterFor("children").id).toBe("nora"); expect(bestWriterFor("finance").id).toBe("claire");
  });
  it("genre specialists win inside their book type", () => {
    expect(bestWriterFor("novel", "Romance").id).toBe("sophia");
    expect(bestWriterFor("novel", "Mystery & Crime").id).toBe("marcus");
    expect(bestWriterFor("novel", "Science Fiction").id).toBe("julian");
    expect(bestWriterFor("comic", "Sci-Fi & Cyberpunk").id).toBe("ethan"); // Julian isn't comic-qualified; type gate wins
  });
  it("a genre never pulls a writer across book type", () => {
    expect(genreSpecialistFor("Romance", "finance")).toBeNull();
    expect(bestWriterFor("finance", "Romance").id).toBe("claire");
    expect(bestWriterFor("children", "Mystery & Crime").id).toBe("nora");
  });
  it("Horror is removed from all sub-category lists", () => {
    for (const genres of Object.values(BOOK_TYPE_GENRES)) expect(genres).not.toContain("Horror");
  });
  it("explicit choice wins; unknown id falls back", () => {
    expect(resolveWriter({ writerId: "marcus" }, "cookbook").id).toBe("marcus");
    expect(resolveWriter({ writerId: "nope" }, "cookbook").id).toBe("luca");
  });
  it("prompt is deterministic (cache-safe) and model-neutral", () => {
    const w = WRITER_PERSONAS[1];
    expect(renderWriterPrompt(w, "business")).toBe(renderWriterPrompt(w, "business"));
    expect(renderWriterPrompt(w, "business")).toContain("Maya Chen");
  });
});
