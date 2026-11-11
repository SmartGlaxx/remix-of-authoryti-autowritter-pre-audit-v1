import { describe, it, expect } from "vitest";
import { writersForType, typesForWriter, sampleTemplate } from "@/lib/startPaths";
import { WRITER_PERSONAS } from "../../supabase/functions/_shared/writers/personas";

describe("two-path start", () => {
  it("path 1 lists only writers who write the chosen type", () => {
    const ws = writersForType("novel");
    expect(ws.length).toBeGreaterThan(0);
    expect(ws.every((w) => w.bookTypes.includes("novel"))).toBe(true);
  });
  it("genre specialist comes first", () => {
    expect(writersForType("novel", "Mystery & Crime")[0].id).toBe("marcus");
  });
  it("path 2 lists the writer's own types", () => {
    const w = WRITER_PERSONAS[0];
    expect(typesForWriter(w.id)).toEqual(w.bookTypes);
  });
  it("sample is a placeholder naming the writer", () => {
    expect(sampleTemplate(WRITER_PERSONAS[0])).toContain(WRITER_PERSONAS[0].name);
  });
});
