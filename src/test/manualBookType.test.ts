import { describe, expect, it } from "vitest";
import {
  BOOK_TEMPLATES,
  BOOK_TYPE_AUDIENCES,
  BOOK_TYPE_GENRES,
  BOOK_TYPE_INFO,
  MANUAL_BOOK_LIMITS,
  VISUAL_BOOK_TYPES,
  getDefaultControls,
} from "@/types/book";
import { adapterForBookType } from "../../supabase/functions/_shared/narrative/planning/adapters";
import { profileForBookType } from "../../supabase/functions/_shared/narrative/adaptiveContext";
import { buildPlanSkeleton, validatePlan } from "../../supabase/functions/_shared/narrative/planning/engine";
import { buildMasterPrompt } from "../../supabase/functions/_shared/narrative/planning/aiPlanning";
import { bestWriterFor, WRITER_PERSONAS } from "../../supabase/functions/_shared/writers/personas";

describe("Manual / E-Guide & Career Journal", () => {
  it("is an enabled visual category with two starting templates", () => {
    expect(BOOK_TYPE_INFO.manual.label).toBe("Manual / E-Guide & Career Journal");
    expect(VISUAL_BOOK_TYPES).toContain("manual");
    expect(BOOK_TEMPLATES.filter((template) => template.bookType === "manual")).toHaveLength(2);
  });

  it("targets 20–50 pages and 6,000–15,000 words, defaulting to 10,000", () => {
    expect(MANUAL_BOOK_LIMITS).toEqual({ minPages: 20, maxPages: 50, minWords: 6000, maxWords: 15000, defaultWords: 10000 });
    const controls = getDefaultControls("manual");
    expect(controls.structureControls.targetWordCount).toBe(10000);
    expect(controls.imageGeneration).toBe(true);
    expect(controls.selectedTemplateId).toBe("manual-quick-start");
  });

  it("offers career and learning topics for adults and professionals", () => {
    expect(BOOK_TYPE_GENRES.manual).toEqual(expect.arrayContaining(["Career Starters", "Learning New Skills"]));
    expect(BOOK_TYPE_AUDIENCES.manual).toEqual(expect.arrayContaining(["general-readers", "professionals"]));
  });

  it("uses the nonfiction editorial adapter and format context profile", () => {
    expect(adapterForBookType("manual").id).toBe("magazine");
    expect(adapterForBookType("manual").isFiction).toBe(false);
    expect(profileForBookType("manual").id).toBe("format");
  });

  it("builds a valid 10,000-word editorial plan", () => {
    const plan = buildPlanSkeleton({
      bookType: "manual",
      targetWords: 10000,
      chapterCount: 5,
      genreData: { issue_theme: "Start a new career", audience: "Beginners", departments: "Quick-start units" },
    });
    expect(validatePlan(plan)).toEqual([]);
    expect(plan.targetWords).toBe(10000);
  });

  it("tells the planner to create a visual quick-start guide with action points", () => {
    const prompt = buildMasterPrompt({
      title: "First Weeks in Tech",
      bookType: "manual",
      premise: "A practical guide for a new career",
      targetWords: 10000,
      chapterCount: 5,
    }, null);
    expect(prompt.user).toContain("20–50 pages");
    expect(prompt.user).toContain("modular quick-start units");
    expect(prompt.user).toContain("summary action points");
  });

  it("has qualified writers and prefers the practical career guide", () => {
    expect(WRITER_PERSONAS.filter((writer) => writer.bookTypes.includes("manual")).length).toBeGreaterThanOrEqual(3);
    expect(bestWriterFor("manual").id).toBe("maya");
  });
});
