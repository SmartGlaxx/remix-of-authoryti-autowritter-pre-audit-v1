import { describe, it, expect } from "vitest";
import { bookToneDirective } from "../../supabase/functions/_shared/writers/toneMatch";
import { cachedInputCost, estimatePipeline } from "../../supabase/functions/_shared/ai/estimate";

describe("book tone reaches planning and rewrites", () => {
  it("untoned books add nothing", () => { expect(bookToneDirective("maya", "", "plan")).toBe(""); expect(bookToneDirective("maya", null, "rewrite")).toBe(""); });
  it("toned plan directive names the tone", () => { expect(bookToneDirective("maya", "Dark", "plan")).toContain('BOOK TONE: "Dark"'); });
  it("toned rewrite directive names the tone", () => { expect(bookToneDirective("maya", "Funny", "rewrite")).toContain('"Funny"'); });
});

describe("cache-aware estimator", () => {
  it("bills cached share at the cached rate", () => {
    // 1M tokens, 60% cached: 0.4*10 + 0.6*1 = 4.6
    expect(cachedInputCost(1_000_000, { inputPerM: 10, cachedPerM: 1 })).toBeCloseTo(4.6);
  });
  it("optional audit is not in the total", () => {
    const e = estimatePipeline(null, 60000);
    const counted = e.roles.filter((r) => r.role !== "auditor").reduce((n, r) => n + (r.costUsd ?? 0), 0);
    if (e.totalUsd != null) expect(e.totalUsd).toBeCloseTo(Math.round(counted * 100) / 100, 2);
  });
});
