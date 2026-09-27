import { describe, it, expect } from "vitest";
import {
  buildCheckerPrompt, buildRevisionPrompt, decide, excerptInSection, isMaterial, isNonfiction, parseCheckerOutput,
  runContinuityLoop, validateRevision, resolutionFor, type ContinuityIssue,
} from "../../supabase/functions/_shared/narrative/continuity.ts";
import { selectNarrativeState, renderNarrativeContext, type NarrativeRows } from "../../supabase/functions/_shared/narrative/context.ts";
import { ACTIVE_ROLES } from "../../supabase/functions/_shared/ai/registry.ts";
import { resolveModelForRole } from "../../supabase/functions/_shared/ai/roles.ts";

const SECTION = `Mara stepped off the train in Calgary, still clutching the brass key. She had never met Tomas before tonight. The harbour lights of Vancouver felt a lifetime away. Rain hammered the platform roof. She was calm now, the fury of the morning spent on the long ride east.`;

const issue = (o: Partial<ContinuityIssue> = {}): ContinuityIssue => ({
  type: "CHARACTER_KNOWLEDGE_CONTRADICTION", classification: "ERROR", severity: "HIGH", confidence: 0.9,
  excerpt: "She had never met Tomas before tonight", conflictingEvidence: "Mara and Tomas are siblings (OUTLINE_CANON)",
  sourceChapter: 1, sourceSubsection: 2, entity: "Mara", authority: "OUTLINE_CANON", explanation: "x", repairable: true,
  suggestedResolution: "Acknowledge she knows Tomas", ...o,
});
const raw = (issues: unknown[]) => JSON.stringify({ issues });

describe("Pass 4 — checker output validation", () => {
  it("1. no contradiction → PASSED", async () => {
    const r = await runContinuityLoop(SECTION, { check: async () => [], revise: async () => { throw new Error("should not revise"); } });
    expect(r.status).toBe("PASSED"); expect(r.finalText).toBe(SECTION); expect(r.revisionCount).toBe(0);
  });
  it("2. genuine knowledge contradiction is kept with evidence", () => {
    const p = parseCheckerOutput(raw([issue()]), SECTION);
    expect(p.issues).toHaveLength(1); expect(p.issues[0].conflictingEvidence).toMatch(/siblings/);
  });
  it.each([
    ["CHARACTER_STATE_CONTRADICTION", "still clutching the brass key"],
    ["LOCATION_CONTRADICTION", "Mara stepped off the train in Calgary"],
    ["INVENTORY_CONTRADICTION", "still clutching the brass key"],
    ["RELATIONSHIP_CONTRADICTION", "She had never met Tomas before tonight"],
    ["TIMELINE_CONTRADICTION", "the fury of the morning spent on the long ride east"],
    ["EVENT_CAUSALITY_CONTRADICTION", "Rain hammered the platform roof"],
    ["PLOT_THREAD_CONTRADICTION", "still clutching the brass key"],
  ])("3. %s is accepted as a typed issue", (type, excerpt) => {
    const p = parseCheckerOutput(raw([issue({ type: type as ContinuityIssue["type"], excerpt })]), SECTION);
    expect(p.issues[0].type).toBe(type);
  });
  it("4. excerpts not present in the section are dropped (no hallucinated evidence)", () => {
    const p = parseCheckerOutput(raw([issue({ excerpt: "Mara drew her sword in the throne room" })]), SECTION);
    expect(p.issues).toHaveLength(0); expect(p.dropped[0].reason).toBe("excerpt_not_in_section");
  });
  it("5. issues with no conflicting evidence are dropped", () => {
    expect(parseCheckerOutput(raw([issue({ conflictingEvidence: "" })]), SECTION).issues).toHaveLength(0);
  });
  it("6. legitimate changes / insufficient info never become issues", () => {
    const p = parseCheckerOutput(raw([issue({ classification: "LEGITIMATE_CHANGE" }), issue({ classification: "INSUFFICIENT_INFO" })]), SECTION);
    expect(p.issues).toHaveLength(0);
  });
  it("7. disputed facts alone are not canon", () => {
    const p = parseCheckerOutput(raw([issue({ conflictingEvidence: "Disputed: Mara has no brother" })]), SECTION);
    expect(p.issues).toHaveLength(0);
  });
  it("8. unparseable checker output throws (→ CHECK_FAILED, never clean)", () => {
    expect(() => parseCheckerOutput("sorry, I cannot help", SECTION)).toThrow();
    expect(() => parseCheckerOutput('{"ok":true}', SECTION)).toThrow();
  });
  it("9. excerpt matching tolerates whitespace/quote differences", () => {
    expect(excerptInSection("  she had   NEVER met Tomas before tonight.", SECTION)).toBe(true);
  });
  it("10. ambiguities are never auto-repairable", () => {
    expect(parseCheckerOutput(raw([issue({ classification: "AMBIGUOUS" })]), SECTION).issues[0].repairable).toBe(false);
  });
});

describe("Pass 4 — decisions", () => {
  it("11. LOW / low-confidence issues are warnings, never revised", () => {
    expect(isMaterial(issue({ severity: "LOW" }))).toBe(false);
    expect(isMaterial(issue({ severity: "MEDIUM", confidence: 0.4 }))).toBe(false);
    expect(decide([issue({ severity: "LOW" })])).toEqual({ kind: "accept", status: "PASSED_WITH_WARNINGS" });
  });
  it("12. high-severity ambiguity escalates to review", () => {
    expect(decide([issue({ classification: "AMBIGUOUS", repairable: false })]).kind).toBe("review");
  });
  it("13. unrepairable material error escalates (e.g. USER_CANON conflict requiring author choice)", () => {
    expect(decide([issue({ authority: "USER_CANON", repairable: false })]).kind).toBe("review");
  });
  it("14. repairable material error → revise", () => {
    expect(decide([issue()]).kind).toBe("revise");
  });
});

describe("Pass 4 — revision safety and loop", () => {
  const fixed = SECTION.replace("She had never met Tomas before tonight.", "She had not seen her brother Tomas in years.");
  it("15. minimal repair accepted; result REVISED; canon untouched", async () => {
    let checks = 0;
    const r = await runContinuityLoop(SECTION, { check: async (t) => (checks++, t.includes("never met") ? [issue()] : []), revise: async () => fixed });
    expect(r.status).toBe("REVISED"); expect(r.finalText).toBe(fixed); expect(r.revisionCount).toBe(1); expect(checks).toBe(2);
    expect(resolutionFor(r.status)).toBe("auto_resolved");
  });
  it("16. revision prompt forbids invented facts and carries canonical evidence", () => {
    const p = buildRevisionPrompt({ sectionText: SECTION, issues: [issue()], stateText: "Mara: sibling of Tomas", nonfiction: false });
    expect(p.system).toMatch(/Do NOT invent/); expect(p.system).toMatch(/Never change established canon/);
    expect(p.user).toContain("siblings"); expect(p.user).toContain(SECTION);
  });
  it("17. rewrites that drift (not minimal) are rejected", () => {
    const long = SECTION + " " + SECTION;
    expect(validateRevision(long, "Completely different text about dragons and castles that shares nothing at all with the original and is long enough to pass the length check only barely, more words here to pad it out properly so it is fine.").ok).toBe(false);
    expect(validateRevision(SECTION, "").ok).toBe(false);
    expect(validateRevision(SECTION, "Here is the revised section:\n" + fixed).ok).toBe(false);
    expect(validateRevision(SECTION, fixed).ok).toBe(true);
  });
  it("18. 3-cycle limit → NEEDS_REVIEW keeping the best version", async () => {
    let n = 0;
    const r = await runContinuityLoop(SECTION, {
      check: async (t) => (t === SECTION ? [issue({ severity: "CRITICAL" })] : [issue({ severity: "MEDIUM" })]),
      revise: async (t) => (n++, t.replace("Rain", n % 2 ? "Sleet" : "Rain")),
    });
    expect(r.status).toBe("NEEDS_REVIEW"); expect(r.revisionCount).toBe(3); expect(r.finalText).not.toBe(SECTION);
    expect(r.attempts.at(-1)?.note).toMatch(/limit/);
  });
  it("19. checker failure preserves the section and marks CHECK_FAILED", async () => {
    const r = await runContinuityLoop(SECTION, { check: async () => { throw new Error("gateway 503"); }, revise: async () => "" });
    expect(r.status).toBe("CHECK_FAILED"); expect(r.finalText).toBe(SECTION); expect(r.error).toMatch(/503/);
  });
  it("20. reviser failure preserves the original", async () => {
    const r = await runContinuityLoop(SECTION, { check: async () => [issue()], revise: async () => { throw new Error("boom"); } });
    expect(r.status).toBe("NEEDS_REVIEW"); expect(r.finalText).toBe(SECTION); expect(r.issues).toHaveLength(1);
  });
  it("21. failed re-check keeps the last verified version (unverified revision discarded)", async () => {
    let calls = 0;
    const r = await runContinuityLoop(SECTION, { check: async () => { if (calls++) throw new Error("x"); return [issue()]; }, revise: async () => fixed });
    expect(r.finalText).toBe(SECTION); expect(r.status).toBe("NEEDS_REVIEW");
  });
});

describe("Pass 4 — state, prompts, roles", () => {
  const P = (c: number, s: number) => c * 10000 + s;
  const rows: NarrativeRows = { characters: [{ id: "c1", name: "Mara", is_active: true, aliases: [] }], states: [
    { id: "s1", character_id: "c1", chapter_index: 0, subsection_index: 0, position: P(0, 0), location_text: "Vancouver", knowledge: [], current_goals: [], inventory: [], secrets_known: [], beliefs: {}, relationships: {}, version: 1, is_current: true },
    { id: "s2", character_id: "c1", chapter_index: 1, subsection_index: 0, position: P(1, 0), location_text: "FUTURE_PLACE", knowledge: [], current_goals: [], inventory: [], secrets_known: [], beliefs: {}, relationships: {}, version: 1, is_current: true },
  ], events: [], participants: [], threads: [], threadEvents: [], facts: [], timeline: [], entities: [], snapshots: [] };
  it("22. checker sees only state strictly before the section (regenerations never see themselves or the future)", () => {
    const txt = renderNarrativeContext(selectNarrativeState(rows, { chapterIndex: 1, subsectionIndex: 0 }));
    expect(txt).toContain("Vancouver"); expect(txt).not.toContain("FUTURE_PLACE");
  });
  it("23. fiction prompt covers flashbacks, per-character knowledge, authority and excludes style", () => {
    const p = buildCheckerPrompt({ stateText: "x", sectionText: SECTION, nonfiction: false, chapterNumber: 2, subsectionNumber: 1 });
    expect(p.system).toMatch(/flashbacks are legitimate/); expect(p.system).toMatch(/per character/);
    expect(p.system).toMatch(/USER_CANON > OUTLINE_CANON/); expect(p.system).toMatch(/Style.*OUT OF SCOPE/);
  });
  it("24. nonfiction prompt checks internal consistency only, no external fact-checking", () => {
    expect(isNonfiction("self_help")).toBe(true); expect(isNonfiction("novel")).toBe(false);
    const p = buildCheckerPrompt({ stateText: "", sectionText: "Rule of three.", nonfiction: true, chapterNumber: 1, subsectionNumber: 1 });
    expect(p.system).toMatch(/NONFICTION/); expect(p.system).toMatch(/Do NOT fact-check/);
  });
  it("25. checker and reviser roles are active and resolvable through the Pass 3 layer", () => {
    expect(ACTIVE_ROLES).toContain("continuity_checker"); expect(ACTIVE_ROLES).toContain("continuity_reviser");
    expect(resolveModelForRole(null, "continuity_reviser").model).toBe("google/gemini-2.5-pro");
    expect(resolveModelForRole({ mode: "optimized" }, "continuity_checker").model).toBe("openai/gpt-6-luna");
  });
});

import { isMaterial as _isMat, decide as _decide } from "../../supabase/functions/_shared/narrative/continuity";
describe("severity protection vs repair eligibility", () => {
  const base = { type: "FACT_CONTRADICTION", classification: "ERROR", excerpt: "x", conflictingEvidence: "y", explanation: "z", repairable: true } as any;
  it("HIGH low-confidence stays an error but is not auto-repaired", () => {
    const i = { ...base, severity: "HIGH", confidence: 0.3 };
    expect(_isMat(i)).toBe(true);
    expect(_decide([i]).kind).toBe("review");
  });
  it("CRITICAL is material at any confidence", () => expect(_isMat({ ...base, severity: "CRITICAL", confidence: 0.1 })).toBe(true));
  it("MEDIUM low-confidence is a warning", () => expect(_isMat({ ...base, severity: "MEDIUM", confidence: 0.4 })).toBe(false));
  it("HIGH confident repairable is revised", () => expect(_decide([{ ...base, severity: "HIGH", confidence: 0.9 }]).kind).toBe("revise"));
});

describe("Pass 4 follow-up fixes", async () => {
  const m = await import("../../supabase/functions/_shared/narrative/continuity");
  it("short section: a one-sentence fix is accepted", () => {
    const o = "Mara held the brass key tightly in her hand. She walked toward the old door slowly. The hallway smelled of dust and rain. She turned the key and stepped inside the room.";
    const r = o.replace("brass key", "silver key").replace("turned the key", "turned the silver key");
    expect(m.validateRevision(o, r).ok).toBe(true);
  });
  it("time budget stops further revision and sends to review", async () => {
    let t = 0;
    const issue = { type: "FACT_CONTRADICTION", classification: "ERROR", severity: "HIGH", confidence: 0.9, excerpt: "x", conflictingEvidence: "y", repairable: true, explanation: "", suggestedResolution: "" } as any;
    const res = await m.runContinuityLoop("orig text here.", {
      check: async () => [issue],
      revise: async (s: string) => { t += 200_000; return s; },
    }, 3, { budgetMs: 100_000, now: () => t });
    expect(res.status).toBe("NEEDS_REVIEW");
    expect(res.revisionCount).toBe(1);
  });
});
