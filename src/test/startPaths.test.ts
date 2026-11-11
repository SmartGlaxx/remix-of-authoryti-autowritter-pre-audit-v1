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
import { isAdminEmail } from "@/lib/admin";
describe("author mapping visibility", () => {
  it("only the admin email sees mappings", () => {
    expect(isAdminEmail("mailsmartcodes@gmail.com")).toBe(true);
    expect(isAdminEmail("someone@example.com")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
  });
  it("placeholder sample never names the real author", () => {
    expect(sampleTemplate(WRITER_PERSONAS.find((w) => w.id === "marcus")!)).not.toContain("Chase");
  });
});
import { AUTHORS } from "../../supabase/functions/_shared/writers/authorDna";
describe("persona text shown to users", () => {
  it("never contains a real author's name", () => {
    for (const w of WRITER_PERSONAS) for (const a of AUTHORS) {
      const shown = [w.tagline, w.personality, w.signature, w.background, w.rhythm, sampleTemplate(w)].join(" ");
      expect(shown.includes(a.name), `${w.id} shows ${a.name}`).toBe(false);
    }
  });
});
