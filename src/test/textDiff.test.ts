import { describe, it, expect } from "vitest";
import { changeRatio, diffStats } from "../../supabase/functions/_shared/writers/textDiff";
import { runNaturalnessRewrite, applyEdits } from "../../supabase/functions/_shared/writers/naturalnessRewrite";
import { revisionChangeRatio, decideRevision } from "../../supabase/functions/_shared/narrative/planning/validation";

const para = (i: number) => `Mara walked along the shore at dusk number ${i}. The water was grey and still, and the reeds bent low in the cold wind off the lake.`;
const LONG = Array.from({ length: 30 }, (_, i) => para(i)).join("\n\n");

describe("word-level change ratio", () => {
  it("unchanged candidate is 0%", () => { expect(changeRatio(LONG, LONG)).toBe(0); });
  it("small edits at opposite ends stay small (not the span between)", () => {
    const r = LONG.replace("Mara walked along the shore at dusk number 0", "Mara strolled along the shore at dusk number 0").replace("cold wind off the lake.", "cold wind off the water.");
    // count only the last occurrence change: replace() hits first only; edit the final paragraph explicitly
    const last = LONG.lastIndexOf("cold wind off the lake.");
    const r2 = LONG.slice(0, last) + "cold wind off the water." + LONG.slice(last + "cold wind off the lake.".length);
    const both = r2.replace("Mara walked", "Mara strolled");
    expect(changeRatio(LONG, both)).toBeLessThan(0.01);
    expect(changeRatio(LONG, r)).toBeLessThan(0.01);
  });
  it("many small edits throughout stay proportional", () => {
    const r = LONG.replace(/grey and still/g, "slate and calm");
    const s = diffStats(LONG, r);
    expect(s.deleted).toBe(60); expect(s.inserted).toBe(60);
    expect(s.ratio).toBeGreaterThan(0.05); expect(s.ratio).toBeLessThan(0.2);
  });
  it("large contiguous rewrite exceeds 20%", () => {
    const ps = LONG.split("\n\n"); for (let i = 0; i < 10; i++) ps[i] = "Entirely different sentence about a storm that broke over distant hills tonight.";
    expect(changeRatio(LONG, ps.join("\n\n"))).toBeGreaterThan(0.2);
  });
  it("insertions and deletions are counted", () => {
    const ps = LONG.split("\n\n");
    expect(diffStats(LONG, [...ps, "A brand new closing line appears here."].join("\n\n")).inserted).toBe(8);
    expect(diffStats(LONG, ps.slice(1).join("\n\n")).deleted).toBeGreaterThan(20);
  });
  it("reordered passages count as change (delete + insert)", () => {
    const ps = LONG.split("\n\n"); const moved = [...ps.slice(15), ...ps.slice(0, 15)].join("\n\n");
    expect(changeRatio(LONG, moved)).toBeGreaterThan(0.2);
  });
  it("whitespace/layout-only changes are 0", () => { expect(changeRatio("a b\n\nc", "a  b\n\n\nc")).toBe(0); });
});

describe("rewrite engine uses the corrected measure", () => {
  const draft = LONG.replace(para(0), `The truth is, ${para(0)}`).replace(para(29), `At the end of the day, ${para(29)}`);
  it("two tiny edits at opposite ends are now accepted", async () => {
    const model = async () => ({ text: JSON.stringify({ edits: [{ find: "The truth is, Mara", replace: "Mara" }, { find: "At the end of the day, Mara", replace: "Mara" }] }) });
    const r = await runNaturalnessRewrite(draft, { mode: "analyze_and_rewrite" }, model);
    expect(r.attempts[0].reason).toBe("improved"); expect(r.changed).toBe(true);
    expect(r.proposals![0].changeRatio).toBeLessThan(0.02);
  });
  it("changes accumulated over two attempts are measured against the original", async () => {
    const ps = draft.split("\n\n");
    let n = 0;
    const model = async () => { n++; const blk = ps.slice(n === 1 ? 1 : 8, n === 1 ? 7 : 14).join("\n\n"); return { text: JSON.stringify({ edits: [{ find: blk, replace: "Short." }] }) }; };
    const r = await runNaturalnessRewrite(draft, { mode: "analyze_and_rewrite", changeLimit: 0.3 }, model);
    // second proposal's ratio covers BOTH blocks vs the original, not just its own
    if (r.proposals!.length === 2 && r.attempts[0].accepted) expect(r.proposals![1].changeRatio).toBeGreaterThan(r.proposals![0].changeRatio);
    for (const p of r.proposals!) expect(p.changeRatio).toBeGreaterThan(0);
  });
  it("protected content (dialogue, numbers) is still refused", () => {
    const t = 'She said "go home" at 9.';
    expect(applyEdits(t, [{ find: '"go home"', replace: '"leave"' }]).applied).toBe(0);
    expect(applyEdits(t, [{ find: "at 9", replace: "at 10" }]).applied).toBe(0);
  });
});

describe("continuity revision ratio (held drafts)", () => {
  it("one word in each of 3 of 7 paragraphs is no longer ~43%", () => {
    const ps = Array.from({ length: 7 }, (_, i) => para(i));
    const rev = ps.map((p, i) => (i < 3 ? p.replace("grey", "dark") : p)).join("\n\n");
    expect(revisionChangeRatio(ps.join("\n\n"), rev)).toBeLessThan(0.05);
    expect(decideRevision({ original: ps.join("\n\n"), revised: rev, draftInCanon: false }).apply).toBe(true);
  });
  it("accepted prose stays protected regardless of ratio", () => {
    expect(decideRevision({ original: LONG, revised: LONG.replace("grey", "dark"), draftInCanon: true }).apply).toBe(false);
  });
});
