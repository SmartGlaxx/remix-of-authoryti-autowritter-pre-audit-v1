import { describe, it, expect } from "vitest";
import { PROFILES, TIERS } from "../../supabase/functions/_shared/writers/profiles";
import { WRITER_PERSONAS } from "../../supabase/functions/_shared/writers/personas";
import { getModel } from "../../supabase/functions/_shared/ai/registry";
import { resolveModelForRole, normalizeConfig, LEGACY_ROLE_MODELS } from "../../supabase/functions/_shared/ai/roles";
import { parseGatewayCatalog, isStale } from "../../supabase/functions/_shared/ai/pricing";
import { buildVoiceManifest } from "../../supabase/functions/_shared/writers/manifest";

describe("premier writer pipeline (tiers removed)", () => {
  it("every writer and every legacy saved tier resolves to the same premier pipeline", () => {
    expect(WRITER_PERSONAS.every((w) => PROFILES[w.id])).toBe(true);
    expect(TIERS).toHaveLength(1);
    for (const w of WRITER_PERSONAS) for (const tier of ["economy", "balanced", "professional", "maximum"] as const) {
      const c = { mode: "profile" as const, profileWriter: w.id, profileTier: tier };
      expect(resolveModelForRole(c, "writer").model).toBe("anthropic/claude-sonnet-5");
      expect(resolveModelForRole(c, "continuity_reviser").model).toBe("openai/gpt-6-sol");
      expect(resolveModelForRole(c, "planner").model).toBe("openai/gpt-6-sol");
      expect(resolveModelForRole(c, "narrative_extractor").model).toBe("openai/gpt-6-sol");
    }
  });
  it("no DeepSeek or Gemini anywhere in writer profiles", () => {
    for (const tiers of Object.values(PROFILES)) for (const prof of Object.values(tiers)) for (const slot of Object.values(prof)) expect(slot.model).not.toMatch(/deepseek|gemini/);
  });
  it("every model id exists in the registry (no invented aliases)", () => {
    for (const tiers of Object.values(PROFILES)) for (const prof of Object.values(tiers)) for (const slot of Object.values(prof)) expect(getModel(slot.model), slot.model).toBeTruthy();
  });
  it("legacy defaults all resolve", () => { for (const k of Object.values(LEGACY_ROLE_MODELS)) expect(getModel(k), k).toBeTruthy(); });
  it("profile mode is locked: overrides and fallbacks ignored", () => {
    const c = { mode: "profile" as const, profileWriter: "daniel", profileTier: "maximum" as const, roleModels: { writer: "openai/gpt-6-sol" }, fallbacks: { writer: "openai/gpt-6-sol" } };
    const r = resolveModelForRole(c, "writer");
    expect(r.model).toBe("anthropic/claude-sonnet-5"); expect(r.fallback).toBeNull();
    expect(resolveModelForRole(c, "manuscript_auditor").model).toBe("openai/gpt-6-sol");
  });
  it("invalid profile falls back to legacy", () => expect(normalizeConfig({ mode: "profile", profile_writer: "nope", profile_tier: "balanced" }).mode).toBe("legacy"));
  it("parses gateway pricing", () => {
    const p = parseGatewayCatalog({ data: [{ id: "anthropic/claude-sonnet-5", pricing: { input: { text: { tiers: [{ cost: "0.000002" }], cache_read: { tiers: [{ cost: "0.0000002" }] } } }, output: { text: { tiers: [{ cost: "0.00001" }] } } } }] });
    expect(p["anthropic/claude-sonnet-5"]).toMatchObject({ inputPerM: 2, cachedInputPerM: 0.2, outputPerM: 10 });
    expect(isStale(null)).toBe(true); expect(isStale(new Date().toISOString())).toBe(false);
  });
  it("manifest stores all 15 effective values", () => {
    const m = buildVoiceManifest({ book_type: "novel", tone_profile: {}, controls: { writerId: "julian" } }, { mode: "profile", profileWriter: "julian", profileTier: "balanced" });
    expect(Object.keys(m.effective_slider_values)).toHaveLength(15);
    expect(m.execution_tier).toBe("balanced"); expect(m.baselines_pending).toBe(false); expect(m.baseline_slider_values?.creativity).toBe(10);
  });
});

import { thinkingFor } from "../../supabase/functions/_shared/writers/profiles";
describe("DeepSeek thinking as a mode, not a model", () => {
  it("maps modes", () => { expect(thinkingFor("thinking")).toBe(true); expect(thinkingFor("non-thinking")).toBe(false); expect(thinkingFor(null)).toBeUndefined(); });
  it("profile resolution carries thinking", () => {
    expect(thinkingFor("adaptive")).toBe("deep");
  });
});

import { WRITER_BASELINES, effectiveSlidersFor } from "../../supabase/functions/_shared/writers/manifest";
describe("canonical baselines", () => {
  it("all 12 writers have 15 values in 1–10", () => {
    for (const w of WRITER_PERSONAS) { const b = WRITER_BASELINES[w.id]!; expect(Object.keys(b)).toHaveLength(15); for (const v of Object.values(b)) expect(v >= 1 && v <= 10).toBe(true); }
  });
  it("book sliders are held to baseline ±2", () => {
    const e = effectiveSlidersFor({ book_type: "novel", tone_profile: { formality: 1 }, controls: { writerId: "claire", creativity: 10 } });
    expect(e.formality).toBe(7); expect(e.creativity).toBe(6);
  });
});
