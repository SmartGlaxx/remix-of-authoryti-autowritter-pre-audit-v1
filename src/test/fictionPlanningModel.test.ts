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

import { isTerminalMessage } from "@/hooks/useBookGeneration";
describe("fiction character descriptions and terminal errors", () => {
  it("character descriptions for a novel run on Sonnet 5", async () => {
    const { resolveModelForRole } = await import("../../supabase/functions/_shared/ai/roles");
    expect(resolveModelForRole(null, "character_generator", { bookType: "novel" }).model).toBe("anthropic/claude-sonnet-5");
  });
  it("rate limits and safety refusals are never retried", () => {
    expect(isTerminalMessage("Rate limit exceeded. Please try again later.")).toBe(true);
    expect(isTerminalMessage("lovable_gateway: the AI provider's safety filter refused this request")).toBe(true);
    expect(isTerminalMessage("network timeout")).toBe(false);
  });
});
