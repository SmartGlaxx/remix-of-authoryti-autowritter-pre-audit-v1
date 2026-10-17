import { describe, expect, it, vi } from "vitest";
import { analyzeSection, verbatimDuplicates } from "../../supabase/functions/_shared/writers/naturalnessMetrics";
import { naturalnessBlocksAcceptance, resolveNaturalnessMode } from "../../supabase/functions/_shared/writers/naturalness";
import { runNaturalnessRewrite } from "../../supabase/functions/_shared/writers/naturalnessRewrite";

describe("independent verbatim duplicate detection", () => {
  it("flags a sentence used twice in a short three-sentence draft", () => {
    const text = "The door stayed shut. Rain covered the yard. The door stayed shut.";
    expect(verbatimDuplicates(text).sentences).toEqual([{ text: "The door stayed shut.", count: 2 }]);
    expect(analyzeSection(text).find((f) => f.category === "mechanical_pattern")).toMatchObject({ severity: "advisory", evidence: { subtype: "verbatim_repetition" } });
    expect(analyzeSection(text).some((f) => f.category === "burstiness" || f.category === "figurative_density")).toBe(false);
  });
  it("detects identical paragraphs with normalized whitespace and HTML layout", () => {
    const p = "Rain covered the yard. The door stayed shut.";
    expect(verbatimDuplicates(`${p}\n\nShe waited.\n\n${p.replaceAll(" ", "  ")}`).paragraphs).toEqual([{ text: p, count: 2 }]);
    expect(verbatimDuplicates(`<p>${p}</p><p>She waited.</p><p>${p}</p>`).paragraphs).toEqual([{ text: p, count: 2 }]);
  });
  it("does not treat similar wording or different case as verbatim", () => {
    expect(verbatimDuplicates("The door stayed shut. The door remained shut. the door stayed shut.").sentences).toEqual([]);
  });
  it("exempts straight, curly and single-quoted dialogue", () => {
    for (const [open, close] of [['"', '"'], ["“", "”"], ["'", "'"], ["‘", "’"]]) {
      expect(verbatimDuplicates(`${open}Stay here.${close}\n\n${open}Stay here.${close}`)).toEqual({ sentences: [], paragraphs: [] });
    }
  });
  it("exempts multiline and unclosed dialogue without hiding surrounding prose", () => {
    expect(verbatimDuplicates('“Stay here.\n\nStay here.”').sentences).toEqual([]);
    expect(verbatimDuplicates('“Stay here. Stay here.').sentences).toEqual([]);
    expect(verbatimDuplicates('Rain fell. “Stay here.” Rain fell.').sentences).toEqual([{ text: "Rain fell.", count: 2 }]);
  });
  it("preserves contractions in prose", () => {
    expect(verbatimDuplicates("She couldn't sleep. She couldn't sleep.").sentences).toEqual([{ text: "She couldn't sleep.", count: 2 }]);
  });
  it("exempts protected motifs including deliberate refrains", () => {
    const t = "Nine beats, pause.\n\nNine beats, pause.";
    expect(verbatimDuplicates(t, { protectedMotifs: ["NINE BEATS"] })).toEqual({ sentences: [], paragraphs: [] });
    expect(verbatimDuplicates(t).sentences[0]?.count).toBe(2);
  });
  it("exempts poetry", () => {
    const t = "Rain fell.\n\nRain fell.";
    expect(verbatimDuplicates(t, { bookType: "poetry" })).toEqual({ sentences: [], paragraphs: [] });
    expect(verbatimDuplicates(t, { bookType: "novel" }).paragraphs[0]?.count).toBe(2);
  });
  it("never blocks acceptance", () => {
    expect(naturalnessBlocksAcceptance(analyzeSection("Rain fell. Rain fell."))).toBe(false);
  });
  it("calls no rewrite model in Off, Analyze Only or legacy advise", async () => {
    const model = vi.fn(async () => ({ text: '{"edits":[]}' }));
    for (const naturalness of ["off", "analyze_only", "advise"]) {
      const t = "Rain fell. Rain fell.";
      const result = await runNaturalnessRewrite(t, { mode: resolveNaturalnessMode({ naturalness }) }, model);
      expect(result.text).toBe(t);
      expect(result.changed).toBe(false);
    }
    expect(model).not.toHaveBeenCalled();
  });
  it("keeps duplicate replacements subject to the unique-find safeguard", async () => {
    const t = "Rain fell. Rain fell.";
    const model = vi.fn(async () => ({ text: JSON.stringify({ edits: [{ find: "Rain fell.", replace: "Rain stopped." }] }) }));
    const result = await runNaturalnessRewrite(t, { mode: "analyze_and_rewrite" }, model);
    expect(result.text).toBe(t);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts.every((a) => a.reason === "no_safe_edits")).toBe(true);
  });
});