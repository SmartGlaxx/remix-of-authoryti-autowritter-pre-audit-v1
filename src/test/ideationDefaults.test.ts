import { describe, expect, it } from "vitest";
import { configForPlanningAction, schemaForIdeaAction } from "../../supabase/functions/_shared/ai/ideation";
import { resolveModelForRole, type BookModelConfig } from "../../supabase/functions/_shared/ai/roles";
import { generateAIText } from "../../supabase/functions/_shared/ai/client";
import { PROFILES, TIERS, writerTierOrDefault } from "../../supabase/functions/_shared/writers/profiles";

describe("approved initial story and writer defaults", () => {
  it("uses Astra for all initial actions across all 48 writer profiles", () => {
    for (const writer of Object.keys(PROFILES)) for (const tier of TIERS) {
      const config: BookModelConfig = { mode: "profile", profileWriter: writer, profileTier: tier.value };
      for (const action of ["alternatives", "concepts", "adjust_premise", "twists"]) {
        const result = resolveModelForRole(configForPlanningAction(action, config), "planner");
        expect(result.model).toBe("openai/gpt-6-astra");
        expect(result.fallback).toBeNull();
      }
    }
  });
  it("keeps later planning and explicit custom routing unchanged", () => {
    const config: BookModelConfig = { mode: "custom", roleModels: { planner: "openai/gpt-6-luna" } };
    for (const action of ["master", "chapters", "sections", "beats", "blueprint"]) {
      expect(configForPlanningAction(action, config)).toBe(config);
      expect(resolveModelForRole(configForPlanningAction(action, config), "planner").model).toBe("openai/gpt-6-luna");
      expect(schemaForIdeaAction(action)).toBeUndefined();
    }
  });
  it("starts every writer at Professional when no tier is selected", () => {
    for (const writer of Object.keys(PROFILES)) {
      expect(writerTierOrDefault(undefined)).toBe("professional");
      expect(PROFILES[writer][writerTierOrDefault(null)]).toBe(PROFILES[writer].professional);
    }
  });
  it("preserves every explicit saved tier including Balanced", () => {
    for (const tier of TIERS) expect(writerTierOrDefault(tier.value)).toBe(tier.value);
  });
  it("streams strict Astra schemas without an output cap using the existing adapter", async () => {
    for (const action of ["alternatives", "concepts", "adjust_premise", "twists"]) {
      let captured: Record<string, any> = {};
      const result = await generateAIText({ role: "planner", config: configForPlanningAction(action, null), userId: "test", request: { user: "Return JSON ideas", json: true, jsonSchema: schemaForIdeaAction(action), reasoning: "low" } }, {
        env: { LOVABLE_API_KEY: "test-only" }, getUserKey: async () => null, recordUsage: async () => {},
        fetch: (async (url, init) => {
          expect(String(url)).toBe("https://ai.gateway.lovable.dev/v1/responses");
          captured = JSON.parse(String(init?.body));
          return new Response('data: {"type":"response.output_text.delta","delta":"ok"}\n\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n');
        }) as typeof fetch,
      });
      expect(result.text).toBe("ok");
      expect(captured.model).toBe("openai/gpt-6-astra");
      expect(captured.stream).toBe(true);
      expect(captured.store).toBe(false);
      expect(captured.reasoning).toEqual({ effort: "low", summary: "auto" });
      expect(captured.text.format).toMatchObject({ type: "json_schema", strict: true, schema: { additionalProperties: false } });
      expect(captured.max_output_tokens).toBeUndefined();
      expect(captured.temperature).toBeUndefined();
    }
  });
});