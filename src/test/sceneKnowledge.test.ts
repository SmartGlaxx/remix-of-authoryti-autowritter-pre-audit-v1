import { describe, expect, it } from "vitest";
import { sceneKnowledge } from "../../supabase/functions/_shared/narrative/sceneKnowledge";

const N = "narr-1";
const d = (year: number) => ({ precision: "year", year });
const rows = [
  { identity_id: N, claim: "Father is alive", learned_date: d(1990), learned_chapter_index: 1, certainty: "certain" },
  { identity_id: N, claim: "Father was the traitor", learned_date: d(2005), learned_chapter_index: 3, certainty: "certain" },
];
const immediate = { narrator_identity_id: N, narrative_vantage: "immediate" };

describe("scene chronology filters character knowledge (not chapter order)", () => {
  it("a dated flashback in chapter 5 does not know what was learned later in story time", () => {
    const k = sceneKnowledge(rows, immediate, { storyDate: "1995", isFlashback: true }, 5, 0).map((r) => r.claim);
    expect(k).toEqual(["Father is alive"]);
  });
  it("an undated flashback never assumes chapter-order knowledge", () => {
    expect(sceneKnowledge(rows, immediate, { isFlashback: true }, 5, 0)).toEqual([]);
  });
  it("a linear later scene knows both", () => {
    expect(sceneKnowledge(rows, immediate, null, 5, 0)).toHaveLength(2);
  });
  it("retrospective narration exposes later knowledge only as hindsight", () => {
    const b = { ...immediate, narrative_vantage: "retrospective", narrator_telling_date: d(2020) };
    const k = sceneKnowledge(rows, b, { storyDate: "1995", isFlashback: true }, 5, 0);
    expect(k.find((r) => r.claim === "Father was the traitor")?.access).toBe("hindsight");
    expect(k.find((r) => r.claim === "Father is alive")?.access).toBe("in_scene");
  });
  it("other characters' knowledge never leaks to the narrator", () => {
    expect(sceneKnowledge([{ ...rows[0], identity_id: "other" }], immediate, null, 5, 0)).toEqual([]);
  });
});
