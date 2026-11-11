import { describe, it, expect } from "vitest";
import { resolveModelForRole } from "../../supabase/functions/_shared/ai/roles";
describe("planning model by book type", () => {
  it("fiction plans on Sonnet 5", () => {
    expect(resolveModelForRole(null, "planner", { bookType: "novel" }).model).toBe("anthropic/claude-sonnet-5");
  });
  it("nonfiction plans stay on Sol", () => {
    expect(resolveModelForRole(null, "planner", { bookType: "business" }).model).toBe("openai/gpt-6-sol");
  });
  it("other roles unchanged for fiction", () => {
    expect(resolveModelForRole(null, "narrative_extractor", { bookType: "novel" }).model).toBe("openai/gpt-6-sol");
  });
});
