import { describe, it, expect } from "vitest";
import { parseEditsDetailed, runNaturalnessRewrite } from "../../supabase/functions/_shared/writers/naturalnessRewrite";
import { buildLiteraryPrompt, LITERARY_MAX_OUTPUT } from "../../supabase/functions/_shared/writers/literaryReviser";
import { literaryBenchmarkWorstCase, LITERARY_BENCHMARK_CAP_USD, LITERARY_BENCHMARK_MAX_OUT } from "../../supabase/functions/_shared/writers/abExperiment";

const OK = '{"edits":[{"find":"As the minutes passed, she waited. ","replace":""},{"find":"The truth is, nothing","replace":"Nothing"}]}';

describe("edit extraction across model response formats", () => {
  it("OpenAI-style clean JSON", () => {
    const r = parseEditsDetailed(OK, "complete");
    expect(r.status).toBe("ok"); expect(r.edits).toHaveLength(2);
  });
  it("Anthropic-style preamble + fenced JSON + trailing note", () => {
    const r = parseEditsDetailed("Here are my edits:\n```json\n" + OK + "\n```\nThese tighten the pacing.", "complete");
    expect(r.edits).toHaveLength(2); expect(["ok", "salvaged"]).toContain(r.status);
  });
  it("reversed key order is accepted", () => {
    const r = parseEditsDetailed('{"edits":[{"replace":"","find":"x y z"}]}');
    expect(r.edits).toEqual([{ find: "x y z", replace: "" }]);
  });
  it("escaped quotes and newlines inside strings survive", () => {
    const r = parseEditsDetailed('{"edits":[{"find":"line one\\nline two","replace":"a \\"b\\""}]}');
    expect(r.edits[0]).toEqual({ find: "line one\nline two", replace: 'a "b"' });
  });
  it("truncated mid-array: complete edits are salvaged, the half edit is dropped", () => {
    const cut = '{"edits":[{"find":"As the minutes passed, she waited. ","replace":""},{"find":"As the kettle cooled, she waited. ","replace":""},{"find":"As the rain thin';
    const r = parseEditsDetailed(cut, "max_tokens");
    expect(r.status).toBe("salvaged"); expect(r.truncated).toBe(true); expect(r.edits).toHaveLength(2);
  });
  it("truncated before any complete edit is reported as truncated, not as 'no edits'", () => {
    const r = parseEditsDetailed('{"edits":[{"find":"As the minutes passed, she wai', "max_tokens");
    expect(r.status).toBe("truncated"); expect(r.edits).toHaveLength(0);
  });
  it("truncation is detected from shape even without a stop reason", () => {
    expect(parseEditsDetailed('{"edits":[{"find":"abc').status).toBe("truncated");
  });
  it("finished but unreadable output is malformed", () => {
    expect(parseEditsDetailed("I would remove the repeated openers and the stock phrases.", "complete").status).toBe("malformed");
  });
  it("empty output is empty", () => { expect(parseEditsDetailed("", "complete").status).toBe("empty"); });
  it("a well-formed empty edit list is a genuine 'nothing to change'", () => {
    const r = parseEditsDetailed('{"edits":[]}', "complete"); expect(r.status).toBe("ok"); expect(r.edits).toHaveLength(0);
  });
  it("more than 12 edits are capped and the overflow counted", () => {
    const many = { edits: Array.from({ length: 15 }, (_, i) => ({ find: `f${i}`, replace: "" })) };
    const r = parseEditsDetailed(JSON.stringify(many)); expect(r.edits).toHaveLength(12); expect(r.dropped).toBe(3);
  });
});

describe("rewrite loop reports infrastructure failures honestly", () => {
  const draft = Array.from({ length: 10 }, (_, i) => `As the light number ${["one","two","three","four","five","six","seven","eight","nine","ten"][i]} shifted, she waited. She moved on.`).join(" ") + " At the end of the day, she still had to choose.";
  it("truncated with nothing recoverable → output_truncated, text unchanged", async () => {
    const r = await runNaturalnessRewrite(draft, { mode: "analyze_and_rewrite", maxAttempts: 1 }, async () => ({ text: '{"edits":[{"find":"As the li', stopReason: "max_tokens" }));
    expect(r.attempts[0].reason).toBe("output_truncated"); expect(r.text).toBe(draft);
    expect(r.proposals?.[0].outputStatus).toBe("truncated"); expect(r.proposals?.[0].stopReason).toBe("max_tokens");
  });
  it("malformed → output_malformed (never 'no_safe_edits')", async () => {
    const r = await runNaturalnessRewrite(draft, { mode: "analyze_and_rewrite", maxAttempts: 1 }, async () => ({ text: "Sure! I'd cut the openers.", stopReason: "complete" }));
    expect(r.attempts[0].reason).toBe("output_malformed");
  });
  it("salvaged edits from a truncated reply still pass every safety gate", async () => {
    const r = await runNaturalnessRewrite(draft, { mode: "analyze_and_rewrite", maxAttempts: 1 }, async () => ({ text: '{"edits":[{"find":"At the end of the day, she","replace":"She"},{"find":"\\"x', stopReason: "max_tokens" }));
    expect(r.proposals?.[0].outputStatus).toBe("salvaged"); expect(r.proposals?.[0].rawEdits).toHaveLength(1);
  });
});

describe("concise interface and revised limits", () => {
  it("prompt demands JSON only, ≤12 short edits, no explanations or full section", () => {
    const p = buildLiteraryPrompt("A b c.", []).system;
    expect(p).toMatch(/ONLY one JSON object/); expect(p).toMatch(/At most 12 edits/); expect(p).toMatch(/never the rewritten section/);
  });
  it("both benchmark models get the same, larger output ceiling", () => {
    expect(LITERARY_BENCHMARK_MAX_OUT.reviser).toBe(2500); expect(LITERARY_MAX_OUTPUT).toBe(2500);
  });
  it("v2 worst case fits $0.32 with equal reservations for Astra and Fable", () => {
    const vp = (t: string) => ({ system: "check", user: t });
    const w = literaryBenchmarkWorstCase("x ".repeat(2700), vp);
    expect(w.astra).toBeCloseTo(w.fable, 6); expect(w.total).toBeLessThanOrEqual(LITERARY_BENCHMARK_CAP_USD);
    expect(LITERARY_BENCHMARK_CAP_USD).toBe(0.32);
  });
});
