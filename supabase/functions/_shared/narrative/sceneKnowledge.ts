// What the narrator may hold in one scene, for display. Mirrors loadNarratorContext exactly:
// scene point from the section plan (storyDate / isFlashback / nonLinear), narrative vantage and telling point.
import type { ApproximateDate, NarrativeVantage } from "./chronology.ts";
import { narratorBoundaries, parseStoryDate, scenePoint } from "./knowledge.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export function sceneKnowledge(rows: Row[], book: Row, sectionPlan: Row | null, chapterIndex: number, subsectionIndex: number): Row[] {
  if (!book?.narrator_identity_id) return [];
  const sd = sectionPlan?.storyDate;
  const sceneDate = sd && typeof sd === "object" ? sd as ApproximateDate : parseStoryDate(typeof sd === "string" ? sd : null);
  const scene = scenePoint({ chapterIndex, subsectionIndex, storyDate: sceneDate, nonLinear: sectionPlan?.isFlashback === true || sectionPlan?.nonLinear === true });
  const vantage: NarrativeVantage = book.narrative_vantage === "retrospective" ? "retrospective" : "immediate";
  const telling = book.narrator_telling_date ? { date: book.narrator_telling_date as ApproximateDate } : null;
  const b = narratorBoundaries(rows, book.narrator_identity_id, scene, vantage, telling);
  return [
    ...b.inScene.map((r) => ({ ...r, access: "in_scene" })),
    ...b.hindsightOnly.map((r) => ({ ...r, access: "hindsight" })),
  ].slice(0, 25);
}
