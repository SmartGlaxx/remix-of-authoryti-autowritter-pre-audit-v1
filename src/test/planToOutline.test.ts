import { describe, it, expect } from "vitest";
import { buildOutlineFromPlans } from "@/lib/planToOutline";

const master = { id: "m1", plan_skeleton: { chapters: [
  { chapterIndex: 0, objective: "Open", sections: [{ sectionIndex: 0, objective: "", targetWords: 800 }, { sectionIndex: 1, objective: "Two", targetWords: 700 }] },
  { chapterIndex: 1, objective: "Next", sections: [{ sectionIndex: 0, objective: "Three", targetWords: 900 }] },
] } };
const plans = [
  { plan_level: "SECTION", plan_status: "READY", chapter_index: 0, subsection_index: 0, version: 1, content: { detail: { entry: "Old entry.", focus: "F", outcome: "O" } } },
  { plan_level: "SECTION", plan_status: "READY", chapter_index: 0, subsection_index: 0, version: 2, content: { detail: { entry: "She waits.", focus: "Focus.", outcome: "Ends." } } },
  { plan_level: "SECTION", plan_status: "PLANNED", chapter_index: 1, subsection_index: 0, version: 3, content: { detail: { entry: "Unapproved." } } },
];

describe("plan-to-outline bridge", () => {
  it("creates every planned chapter and section", () => {
    const o = buildOutlineFromPlans(master, plans);
    expect(o.chapters).toHaveLength(2);
    expect(o.chapters[0].subsections).toHaveLength(2);
  });
  it("uses the latest approved section summary", () => {
    const s = buildOutlineFromPlans(master, plans).chapters[0].subsections[0];
    expect(s.summary).toBe("She waits.\n\nFocus.\n\nEnds.");
    expect(s.goal).toBe("Ends.");
  });
  it("ignores unapproved plans", () => {
    expect(buildOutlineFromPlans(master, plans).chapters[1].subsections[0].summary).toBe("Three");
  });
  it("keeps prose already written", () => {
    const prev = { chapters: [{ subsections: [{ content: "Written prose", status: "completed" }] }] };
    const s = buildOutlineFromPlans(master, plans, prev).chapters[0].subsections[0];
    expect(s.content).toBe("Written prose");
    expect(s.status).toBe("completed");
  });
});
