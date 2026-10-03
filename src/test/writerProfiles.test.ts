import { describe, it, expect } from "vitest";
import { PROFILES, TIERS } from "../../supabase/functions/_shared/writers/profiles";
import { WRITER_PERSONAS } from "../../supabase/functions/_shared/writers/personas";
import { getModel } from "../../supabase/functions/_shared/ai/registry";
import { resolveModelForRole, normalizeConfig, LEGACY_ROLE_MODELS } from "../../supabase/functions/_shared/ai/roles";
import { parseGatewayCatalog, isStale } from "../../supabase/functions/_shared/ai/pricing";
import { buildVoiceManifest } from "../../supabase/functions/_shared/writers/manifest";

describe("48 fixed writer profiles", () => {
  it("every writer has all 4 tiers (48 total)", () => {
    expect(WRITER_PERSONAS.every((w) => PROFILES[w.id])).toBe(true);
    expect(Object.values(PROFILES).flatMap((t) => TIERS.map((x) => t[x.value])).filter(Boolean)).toHaveLength(48);
  });
  it("every model id exists in the registry (no invented aliases)", () => {
    for (const tiers of Object.values(PROFILES)) for (const prof of Object.values(tiers)) for (const slot of Object.values(prof)) expect(getModel(slot.model), slot.model).toBeTruthy();
  });
  it("legacy defaults all resolve", () => { for (const k of Object.values(LEGACY_ROLE_MODELS)) expect(getModel(k), k).toBeTruthy(); });
  it("profile mode is locked: overrides and fallbacks ignored", () => {
    const c = { mode: "profile" as const, profileWriter: "daniel", profileTier: "maximum" as const, roleModels: { writer: "openai/gpt-6-luna" }, fallbacks: { writer: "openai/gpt-6-luna" } };
    const r = resolveModelForRole(c, "writer");
    expect(r.model).toBe("openai/gpt-6-sol"); expect(r.reasoning).toBe("high"); expect(r.fallback).toBeNull();
    expect(resolveModelForRole(c, "manuscript_auditor").model).toBe("openai/gpt-6-astra");
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
    expect(m.execution_tier).toBe("balanced"); expect(m.baselines_pending).toBe(true);
  });
});

import { thinkingFor } from "../../supabase/functions/_shared/writers/profiles";
describe("DeepSeek thinking as a mode, not a model", () => {
  it("maps modes", () => { expect(thinkingFor("thinking")).toBe(true); expect(thinkingFor("non-thinking")).toBe(false); expect(thinkingFor(null)).toBeUndefined(); });
  it("profile resolution carries thinking", () => {
    expect(resolveModelForRole({ mode: "profile", profileWriter: "maya", profileTier: "economy" }, "writer")).toMatchObject({ model: "deepseek/deepseek-flash", thinking: false });
  });
});
