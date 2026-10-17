import { describe, it, expect } from "vitest";
import { resolveModelForRole, LEGACY_ROLE_MODELS } from "../../supabase/functions/_shared/ai/roles";

describe("fast draft resolution", () => {
  it("swaps deepseek-reasoner for deepseek-chat on prose roles when fast", () => {
    const r = resolveModelForRole({ mode: "legacy" }, "writer", { fast: true });
    expect(r.model).toBe("deepseek/deepseek-chat");
    expect(r.reasoning).toBeUndefined();
    expect(r.thinking).toBeUndefined();
  });

  it("leaves the writer unchanged when fast is off", () => {
    expect(resolveModelForRole({ mode: "legacy" }, "writer").model).toBe("deepseek/deepseek-reasoner");
  });

  it("never changes non-prose roles, even when fast", () => {
    expect(resolveModelForRole({ mode: "legacy" }, "continuity_checker", { fast: true }).model)
      .toBe(LEGACY_ROLE_MODELS.continuity_checker);
    expect(resolveModelForRole({ mode: "legacy" }, "narrative_extractor", { fast: true }).model)
      .toBe(LEGACY_ROLE_MODELS.narrative_extractor);
  });

  it("keeps the optimized writer on Sol in both modes", () => {
    expect(resolveModelForRole({ mode: "optimized" }, "writer", { fast: true }).model).toBe("openai/gpt-6-sol");
    expect(resolveModelForRole({ mode: "optimized" }, "writer").model).toBe("openai/gpt-6-sol");
  });

  it("applies to difficult_chapter and intro_writer too", () => {
    expect(resolveModelForRole({ mode: "legacy" }, "difficult_chapter", { fast: true }).model).toBe("deepseek/deepseek-chat");
    expect(resolveModelForRole({ mode: "legacy" }, "intro_writer", { fast: true }).model).toBe("deepseek/deepseek-chat");
  });
});
