import { describe, it, expect } from "vitest";
import { resolveModelForRole } from "../../supabase/functions/_shared/ai/roles";
const cfg = { mode: "profile" as const, profileWriter: "marcus", profileTier: "professional" as const };
describe("book-type drafting model", () => {
  it("drama drafts on Sol", () => expect(resolveModelForRole(cfg, "writer", { bookType: "drama" }).model).toBe("openai/gpt-6-sol"));
  it("novel drafts on Sonnet 5", () => expect(resolveModelForRole(cfg, "writer", { bookType: "novel" }).model).toBe("anthropic/claude-sonnet-5"));
  it("drama checks still use Luna", () => expect(resolveModelForRole(cfg, "continuity_checker", { bookType: "drama" }).model).toBe("openai/gpt-6-luna"));
});
