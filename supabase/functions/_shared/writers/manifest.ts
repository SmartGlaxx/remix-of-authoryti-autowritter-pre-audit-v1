// Book Voice Manifest: frozen snapshot of writer, tier, locked models and all 15 slider values,
// taken when the first section is written. Pure builder.
import { resolveAllRoles, type BookModelConfig } from "../ai/roles.ts";
import { boundAll, readSliders, resolveDivergence, MAX_ADJUST, type SliderValues } from "./sliders.ts";
import { resolveWriter } from "./personas.ts";

/** Canonical 15-slider baselines per writer. Empty until the final matrix is supplied. */
export const WRITER_BASELINES: Partial<Record<string, SliderValues>> = {};

// deno-lint-ignore no-explicit-any
export function buildVoiceManifest(book: { book_type: string; tone_profile: any; controls: any }, config: BookModelConfig, pricesFetchedAt: string | null = null) {
  const writer = resolveWriter(book.controls ?? {}, book.book_type);
  const requested = readSliders(book.tone_profile, book.controls);
  const baseline = WRITER_BASELINES[writer.id] ?? null;
  const roles = resolveAllRoles(config);
  return {
    version: 1,
    writer_id: writer.id,
    model_mode: config.mode,
    execution_tier: config.mode === "profile" ? config.profileTier ?? null : null,
    models: Object.fromEntries(Object.entries(roles).map(([r, v]) => [r, { model: v.model, reasoning: v.reasoning ?? null }])),
    baseline_slider_values: baseline,
    baselines_pending: !baseline,
    effective_slider_values: baseline ? boundAll(baseline, requested) : requested,
    slider_adjustment_limit: MAX_ADJUST,
    story_divergence: resolveDivergence(book.controls),
    pricing_timestamp: pricesFetchedAt,
    created_at: new Date().toISOString(),
  };
}
