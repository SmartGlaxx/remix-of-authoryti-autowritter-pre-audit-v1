import { describe, it, expect } from "vitest";
import { AUTHORS, AVATAR_AUTHORS, resolveAuthor, authorVoiceDirective } from "../../supabase/functions/_shared/writers/authorDna";
import { WRITER_PERSONAS, renderWriterPrompt, getWriter } from "../../supabase/functions/_shared/writers/personas";
import { TIME_PLAN_ENABLED } from "../../supabase/functions/_shared/narrative/planning/aiPlanning";
import { textDossierLock, validateCharacterLock } from "../../supabase/functions/_shared/narrative/characterReference";

describe("real-author voices", () => {
  it("has 40 authors (no V. C. Andrews) and 30 writers", () => {
    expect(AUTHORS).toHaveLength(40);
    expect(AUTHORS.some((a) => /andrews/i.test(a.name))).toBe(false);
    expect(WRITER_PERSONAS).toHaveLength(30);
  });
  it("every author belongs to exactly one existing writer", () => {
    const used = Object.values(AVATAR_AUTHORS).flat();
    expect(new Set(used).size).toBe(40);
    for (const id of Object.keys(AVATAR_AUTHORS)) expect(getWriter(id)).not.toBeNull();
  });
  it("Marcus writes as James Hadley Chase with the originality rules in the draft prompt", () => {
    const p = renderWriterPrompt(getWriter("marcus")!, "novel");
    expect(p).toContain("writing as James Hadley Chase");
    expect(p).toContain("Never copy, remix or closely resemble");
  });
  it("a chosen secondary author is honoured only for its own writer", () => {
    expect(resolveAuthor("vivian", "hammett")!.name).toBe("Dashiell Hammett");
    expect(resolveAuthor("vivian", "austen")!.name).toBe("Raymond Chandler");
  });
  it("writers without a real author get no directive", () => {
    expect(authorVoiceDirective("Nora", resolveAuthor("nora"), "plan")).toBe("");
  });
  it("forced time markers are retired", () => { expect(TIME_PLAN_ENABLED).toBe(false); });
  it("a written dossier locks a character without any image", () => {
    const lock = textDossierLock({ heightCm: 170, weightKg: 60, measurementSource: "designed", features: { hair: "black knot" },
      tells: ["at-ease", "a", "b", "c"].map((state, i) => ({ state, cue: `cue ${i}`, purpose: "reveal" as const })), desireLine: "x", heldBackFeature: "y" });
    expect(validateCharacterLock(lock)).toEqual([]);
  });
});
