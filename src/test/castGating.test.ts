import { describe, expect, it } from "vitest";
import { buildNarrativeContext, selectNarrativeState, type NarrativeRows } from "../../supabase/functions/_shared/narrative/context.ts";
import { buildAdaptiveContext } from "../../supabase/functions/_shared/narrative/adaptiveCandidates.ts";
import { plannedDebuts } from "../../supabase/functions/_shared/narrative/cast.ts";

const empty: NarrativeRows = { characters: [], states: [], events: [], participants: [], threads: [], threadEvents: [], facts: [], timeline: [], entities: [], snapshots: [] };
const cast = [
  { id: "mara", name: "Mara Quell", role: "harbor clerk" },
  { id: "hale", name: "John Hale", role: "harbor master" },
  { id: "reyes", name: "John Reyes", role: "dock engineer" },
  { id: "saul", name: "Petr Saul", role: "Hale's deputy, scarred hand" },
];
const sub = (description: string) => ({ title: "Part", description });
const outline = {
  characters: cast,
  chapters: [
    { title: "C1", subsections: [sub("Mara Quell starts as clerk and meets harbor master John Hale."), sub("Mara finds a ledger page missing."), sub("John Reyes warns Mara.")] },
    { title: "C2", subsections: [sub("At the cannery Mara is chased off by a man with a scarred hand.")] },
    { title: "C3", subsections: [sub("The scarred man is identified as Petr Saul, Hale's deputy.")] },
  ],
};
const at = (chapterIndex: number, subsectionIndex: number) => ({ chapterIndex, subsectionIndex });

describe("Planned debuts", () => {
  it("reads debuts from the outline; a shared given name never places someone", () => {
    const d = plannedDebuts(cast, outline.chapters);
    expect(d.get("mara")).toEqual(at(0, 0));
    expect(d.get("hale")).toEqual(at(0, 0));
    expect(d.get("reyes")).toEqual(at(0, 2));
    expect(d.get("saul")).toEqual(at(2, 0));
  });
});

describe("Explicit first-appearance setting", () => {
  const veyCast = [...cast, { id: "vey", name: "Tomas Vey", role: "union organizer" }];
  const veyOutline = {
    characters: veyCast,
    chapters: [
      ...outline.chapters.slice(0, 1),
      { title: "C2", subsections: [sub("At the cannery Mara is chased off by a man with a scarred hand."), sub("The union card names Tomas Vey as organizer."), sub("Mara asks around."), sub("Nobody has seen Vey in weeks.")] },
      { title: "C3", subsections: [sub("The scarred man is identified as Petr Saul, Hale's deputy.")] },
      { title: "C4", subsections: [sub("Mara finds nothing."), sub("A cold trail."), sub("A rumor."), sub("A locked door."), sub("Mara finds Tomas Vey alive in the boathouse.")] },
    ],
  };

  it("a name mention alone would place Tomas Vey in Ch2.1", () => {
    expect(plannedDebuts(veyCast, veyOutline.chapters).get("vey")).toEqual(at(1, 1));
  });

  it("the author's firstAppearance setting overrides the name-mention debut", () => {
    const configured = veyCast.map((c) => c.id === "vey" ? { ...c, firstAppearance: { chapterIndex: 3, subsectionIndex: 4 } } : c);
    expect(plannedDebuts(configured, veyOutline.chapters).get("vey")).toEqual(at(3, 4));
  });

  it("with the setting, Vey stays out of Ch2 context in both modes despite being named there", () => {
    const configured = veyCast.map((c) => c.id === "vey" ? { ...c, firstAppearance: { chapterIndex: 3, subsectionIndex: 4 } } : c);
    const outline2 = { ...veyOutline, characters: configured };
    expect(buildNarrativeContext(empty, at(1, 2), configured, veyOutline.chapters)).not.toContain("Tomas Vey");
    const { context } = buildAdaptiveContext({ bookType: "novel", position: at(1, 2), objective: "Mara asks about the union", outline: outline2, rows: empty });
    expect(context.text).not.toContain("Tomas Vey");
  });

  it("with the setting, Vey enters at his configured debut section", () => {
    const configured = veyCast.map((c) => c.id === "vey" ? { ...c, firstAppearance: { chapterIndex: 3, subsectionIndex: 4 } } : c);
    expect(buildNarrativeContext(empty, at(3, 4), configured, veyOutline.chapters)).toContain("Tomas Vey [planned to first appear in THIS section]");
  });
});

describe("Standard mode cast", () => {
  it("receives Mara Quell and John Hale before any extraction", () => {
    const ctx = buildNarrativeContext(empty, at(0, 0), cast, outline.chapters);
    expect(ctx).toContain("Mara Quell");
    expect(ctx).toContain("John Hale");
  });

  it("does not introduce Petr Saul before his planned debut, nor John Reyes before his", () => {
    const ctx = buildNarrativeContext(empty, at(1, 0), cast, outline.chapters);
    expect(ctx).not.toContain("Petr Saul");
    expect(buildNarrativeContext(empty, at(0, 1), cast, outline.chapters)).not.toContain("John Reyes");
  });

  it("withholds a seeded outline profile with a later debut too", () => {
    const rows: NarrativeRows = { ...empty, characters: [{ id: "c-saul", name: "Petr Saul", source_key: "saul", is_active: true }] };
    expect(buildNarrativeContext(rows, at(1, 0), cast, outline.chapters)).not.toContain("Petr Saul");
  });

  it("includes Petr Saul at his debut section, marked as entering now", () => {
    expect(buildNarrativeContext(empty, at(2, 0), cast, outline.chapters)).toContain("Petr Saul [planned to first appear in THIS section]");
  });

  it("established characters keep their current state and appear once", () => {
    const rows: NarrativeRows = { ...empty,
      characters: [{ id: "c-mara", name: "Mara Quell", source_key: "mara", is_active: true }],
      states: [{ character_id: "c-mara", chapter_index: 0, subsection_index: 1, location_text: "records room", emotional_state: "suspicious" }] };
    const s = selectNarrativeState(rows, at(1, 0), cast, outline.chapters);
    const maras = s.characters.filter((c) => c.name === "Mara Quell");
    expect(maras).toHaveLength(1);
    expect(maras[0].state?.location).toBe("records room");
    expect(maras[0].state?.emotional).toBe("suspicious");
  });
});

describe("Adaptive mode cast", () => {
  it("does not introduce Petr Saul before his planned debut", () => {
    const { context } = buildAdaptiveContext({ bookType: "novel", position: at(1, 0), objective: "Mara at the cannery", outline, rows: empty });
    expect(context.text).toContain("Mara Quell");
    expect(context.text).not.toContain("Petr Saul");
  });

  it("does not leak a later-debut name through the identity registry", () => {
    const { context } = buildAdaptiveContext({ bookType: "novel", position: at(1, 0), objective: "Continue", outline, rows: empty,
      identityEntities: [{ id: "i1", name: "Petr Saul", kind: "person", aliases: [], introduced_position: 0 }] });
    expect(context.text).not.toContain("Petr Saul");
  });

  it("outline canon stays authoritative at and after the debut", () => {
    const { context } = buildAdaptiveContext({ bookType: "novel", position: at(2, 0), objective: "Identify the scarred man", outline, rows: empty });
    expect(context.text).toContain("Petr Saul [planned to first appear in THIS section] — Hale's deputy, scarred hand");
  });

  it("an established character keeps its recorded state", () => {
    const rows: NarrativeRows = { ...empty,
      characters: [{ id: "c-hale", name: "John Hale", source_key: "hale", is_active: true }],
      states: [{ character_id: "c-hale", chapter_index: 0, subsection_index: 0, emotional_state: "cold" }] };
    const { context } = buildAdaptiveContext({ bookType: "novel", position: at(1, 0), objective: "Continue", outline, rows });
    expect(context.text).toMatch(/John Hale: [^\n]*cold/);
  });
});
