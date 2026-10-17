import { describe, it, expect, vi } from "vitest";
import { runNaturalnessRewrite, applyEdits, editViolation, MAX_NATURALNESS_ATTEMPTS } from "../../supabase/functions/_shared/writers/naturalnessRewrite";

const stock = "At the end of the day the storm was close. Mara crossed the yard slowly in the dusk. " +
  Array.from({ length: 12 }, (_, i) => `She checked the lantern hook ${i} again and moved toward the dark barn wall.`).join(" ") +
  ' "Stay here," Tom said to her. The rain held off until the evening finally ended there.';
const reply = (edits: unknown) => vi.fn(async () => ({ text: JSON.stringify({ edits }) }));

describe("Stage C targeted naturalness rewriting", () => {
  it("does nothing and calls no model unless mode is advise", async () => {
    const m = reply([]);
    for (const mode of ["off", "analyze_only"] as const) {
      const r = await runNaturalnessRewrite(stock, { mode }, m);
      expect(r.text).toBe(stock);
    }
    expect(m).not.toHaveBeenCalled();
  });

  it("keeps a strictly better targeted candidate", async () => {
    const m = reply([{ find: "At the end of the day the storm was close.", replace: "The storm was close." }]);
    const r = await runNaturalnessRewrite(stock, { mode: "advise", changeLimit: 0.5 }, m);
    expect(r.changed).toBe(true);
    expect(r.text.startsWith("The storm was close.")).toBe(true);
    expect(r.text).toContain('"Stay here," Tom said');
  });

  it("never makes more than two attempts", async () => {
    const m = reply([{ find: "not in text", replace: "x" }]);
    const r = await runNaturalnessRewrite(stock, { mode: "advise" }, m);
    expect(m.mock.calls.length).toBeLessThanOrEqual(MAX_NATURALNESS_ATTEMPTS);
    expect(r.text).toBe(stock);
  });

  it("rejects edits to dialogue, names and numbers", () => {
    expect(editViolation(stock, { find: '"Stay here," Tom said', replace: '"Wait," Tom said' })).toBe("dialogue_protected");
    expect(editViolation(stock, { find: "hook 3 again", replace: "hook 4 again" })).toBe("numbers_changed");
    expect(editViolation(stock, { find: "Mara crossed the yard", replace: "She crossed the yard" })).toMatch(/^name_removed/);
    expect(applyEdits(stock, [{ find: "Mara crossed", replace: "Lena crossed" }]).applied).toBe(0);
  });

  it("discards a candidate that changes more than the limit", async () => {
    const m = reply([{ find: stock.slice(0, 600), replace: "Short." }]);
    const r = await runNaturalnessRewrite(stock, { mode: "advise" }, m);
    expect(r.text).toBe(stock);
    expect(r.attempts.every((a) => !a.accepted)).toBe(true);
  });

  it("fails open to the original draft when the model errors", async () => {
    const m = vi.fn(async () => { throw new Error("no credit"); });
    const r = await runNaturalnessRewrite(stock, { mode: "advise" }, m);
    expect(r.text).toBe(stock);
    expect(r.attempts[0].reason).toBe("model_unavailable");
  });
});
