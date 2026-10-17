import { describe, it, expect, vi } from "vitest";
import { runNaturalnessRewrite, editViolation, naturalnessScore } from "../../supabase/functions/_shared/writers/naturalnessRewrite";
import { analyzeSection, repeatedTemplates, verbatimDuplicates } from "../../supabase/functions/_shared/writers/naturalnessMetrics";

const things = ["light shifted", "minutes passed", "kettle cooled", "rain thinned", "clock ticked", "wind rose", "lamp flickered", "floor creaked", "fire settled", "night deepened", "house cooled"];
const FILL = ["Mara sorted fishing lures into a shoebox.", "Somewhere upstairs a pipe knocked twice and went quiet.", "Her father's handwriting covered every label in the pantry.", "Dust rose when she lifted the curtains.", "A moth beat itself against the window over the sink, stubborn and soft.", "She found three keys that opened nothing.", "Rubber bands, receipts, a broken compass.", "Snow had started on the far shore.", "The radio stayed off because she could not bear a voice.", "Mrs. Finch's porch light came on across the cove.", "Every drawer held one more thing he had refused to throw away.", "Cold came up through the floorboards."];
const filler = (i: number) => FILL[i % FILL.length];
const asOpen = things.map((t, i) => `As the ${t}, she waited. ${filler(i)}`).join(" ");
const theOpen = things.map((t, i) => `The ${t} while she waited. ${filler(i)}`).join(" ");
const reply = (edits: unknown) => vi.fn(async () => ({ text: JSON.stringify({ edits }) }));

describe("Naturalness quality corrections", () => {
  it("eleven identical openings swapped for eleven same-shape openings is rejected", async () => {
    expect(repeatedTemplates(asOpen)[0].count).toBe(11);
    expect(repeatedTemplates(theOpen)[0].count).toBe(11);
    const edits = things.slice(0, 11).map((t) => ({ find: `As the ${t}, she waited.`, replace: `The ${t} while she waited.` }));
    const r = await runNaturalnessRewrite(asOpen, { mode: "analyze_and_rewrite", changeLimit: 0.5 }, reply(edits));
    expect(r.text).toBe(asOpen);
    expect(r.attempts[0].reason).toBe("pattern_substituted");
    expect(r.unresolved.some((u) => u.startsWith("repeated sentence shape"))).toBe(true);
  });

  it("repetition moved from one phrase to another is not an improvement", async () => {
    const draft = Array.from({ length: 6 }, (_, i) => `At the end of the day the work went on. ${filler(i)}`).join(" ");
    const edits = [{ find: "At the end of the day the work went on. " + filler(0), replace: "The reality is the work went on. " + filler(0) }];
    const r = await runNaturalnessRewrite(draft, { mode: "analyze_and_rewrite", changeLimit: 0.5 }, reply(edits));
    expect(r.attempts.every((a) => !a.accepted)).toBe(true);
    expect(r.unresolved.length).toBeGreaterThan(0);
  });

  it("genuine structural variation is accepted", async () => {
    const edits = things.slice(0, 6).map((t, i) => ({ find: `As the ${t}, she waited. `, replace: ["", "She gave up on the clock. ", "", "Rain ticked at the glass behind her. ", "", "Her hands kept moving. "][i] }));
    const r = await runNaturalnessRewrite(asOpen, { mode: "analyze_and_rewrite", changeLimit: 0.5 }, reply(edits));
    expect(r.attempts[0].reason).toBe("improved");
    expect(naturalnessScore(r.after)).toBeLessThan(naturalnessScore(r.before));
  });

  it("capitalised non-name words at a sentence start are not names", () => {
    const text = "She waited. Nothing had changed, and nothing would. Theo came in.";
    expect(editViolation(text, { find: "She waited.", replace: "Nothing moved; she waited." })).toBeNull();
    expect(editViolation(text, { find: "Nothing had changed, and nothing would.", replace: "The house had not changed." })).toBeNull();
  });

  it("established names stay protected, including canon names only seen at sentence starts", () => {
    const text = "Theo came in late. She looked at Theo. Wren sat by the door.";
    expect(editViolation(text, { find: "Theo came in late.", replace: "He came in late." })).toMatch(/^name_removed:Theo/);
    expect(editViolation(text, { find: "Wren sat by the door.", replace: "Someone sat by the door." }, ["Wren Holloway"])).toMatch(/^name_removed:Wren/);
    expect(editViolation(text, { find: "Theo came in late.", replace: "Theo came in late with Ivo." })).toMatch(/^name_added:Ivo/);
  });

  it("duplicate sentences hundreds of words apart are found and reported", async () => {
    const dup = "The silence between them stretched into something brittle and thin.";
    const middle = Array.from({ length: 25 }, (_, i) => `The lake lay grey under weather number ${i} while the house settled around old furniture.`).join(" ");
    const text = `${dup} ${middle} ${dup}`;
    expect(verbatimDuplicates(text).sentences[0].count).toBe(2);
    const r = await runNaturalnessRewrite(text, { mode: "analyze_and_rewrite" }, reply([]));
    expect(r.unresolved.some((u) => u.startsWith("duplicate sentence"))).toBe(true);
  });

  it("deliberate three-beat parallelism and protected motifs are not flagged", () => {
    const par = "We walked to the river at dawn. We walked to the river at noon. We walked to the river at dusk. " + filler(1) + " " + filler(2);
    expect(repeatedTemplates(par)).toHaveLength(0);
    expect(repeatedTemplates(asOpen, ["she waited"])).toHaveLength(0);
    expect(analyzeSection(asOpen, { protectedMotifs: ["she waited"] }).some((f) => (f.evidence as any)?.templates?.length)).toBe(false);
  });

  it("a score-lowering revision that flattens rhythm is rejected", async () => {
    const draft = "At the end of the day she stopped. " + Array.from({ length: 10 }, (_, i) => i % 2 ? `She ran ${i}.` : `The road wound down through pines and wet stone for mile ${i} until the valley opened below.`).join(" ");
    const flat = Array.from({ length: 10 }, (_, i) => `The road went down past ${i} wet pines today.`).join(" ");
    const r = await runNaturalnessRewrite(draft, { mode: "analyze_and_rewrite", changeLimit: 1 }, reply([{ find: draft, replace: "She stopped. " + flat }]));
    expect(r.text).toBe(draft);
    expect(r.attempts.every((a) => !a.accepted)).toBe(true);
  });

  it("a one-paragraph fix that degrades the whole section is rejected", async () => {
    const edits = [{ find: "As the light shifted, she waited.", replace: "She waited, and the light shifted, and she waited, and she waited." }];
    const r = await runNaturalnessRewrite(asOpen, { mode: "analyze_and_rewrite", changeLimit: 0.5 }, reply(edits));
    expect(r.text).toBe(asOpen);
  });
});
