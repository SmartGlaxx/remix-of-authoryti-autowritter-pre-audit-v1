// Book Voice Manifest: frozen snapshot of writer, tier, locked models and all 15 slider values,
// taken when the first section is written. Pure builder.
import { resolveAllRoles, type BookModelConfig } from "../ai/roles.ts";
import { boundAll, readSliders, resolveDivergence, MAX_ADJUST, type SliderValues } from "./sliders.ts";
import { resolveWriter } from "./personas.ts";

/** Canonical 15-slider baselines per built-in writer (1–10). Same baseline for all four tiers. */
export const WRITER_BASELINES: Partial<Record<string, SliderValues>> = {
  elena: { formality: 6, emotion: 8, warmth: 9, humor: 3, authority: 6, directness: 5, pacing: 5, elaboration: 7, conceptualComplexity: 7, perspective: 4, creativity: 6, hookFrequency: 5, sensoryDetail: 6, readerIntimacy: 9, sentenceVariation: 7 },
  maya: { formality: 6, emotion: 6, warmth: 6, humor: 4, authority: 9, directness: 9, pacing: 8, elaboration: 7, conceptualComplexity: 7, perspective: 4, creativity: 7, hookFrequency: 8, sensoryDetail: 4, readerIntimacy: 6, sentenceVariation: 7 },
  claire: { formality: 9, emotion: 3, warmth: 4, humor: 1, authority: 9, directness: 8, pacing: 5, elaboration: 9, conceptualComplexity: 9, perspective: 6, creativity: 4, hookFrequency: 4, sensoryDetail: 3, readerIntimacy: 4, sentenceVariation: 6 },
  nora: { formality: 4, emotion: 8, warmth: 9, humor: 9, authority: 4, directness: 6, pacing: 8, elaboration: 6, conceptualComplexity: 5, perspective: 2, creativity: 8, hookFrequency: 9, sensoryDetail: 8, readerIntimacy: 10, sentenceVariation: 8 },
  sophia: { formality: 7, emotion: 9, warmth: 5, humor: 2, authority: 6, directness: 4, pacing: 4, elaboration: 9, conceptualComplexity: 9, perspective: 7, creativity: 9, hookFrequency: 6, sensoryDetail: 9, readerIntimacy: 7, sentenceVariation: 10 },
  priya: { formality: 6, emotion: 6, warmth: 7, humor: 4, authority: 8, directness: 6, pacing: 6, elaboration: 8, conceptualComplexity: 9, perspective: 4, creativity: 7, hookFrequency: 6, sensoryDetail: 7, readerIntimacy: 7, sentenceVariation: 8 },
  daniel: { formality: 8, emotion: 3, warmth: 4, humor: 1, authority: 9, directness: 9, pacing: 8, elaboration: 6, conceptualComplexity: 8, perspective: 6, creativity: 3, hookFrequency: 7, sensoryDetail: 3, readerIntimacy: 3, sentenceVariation: 6 },
  marcus: { formality: 6, emotion: 9, warmth: 6, humor: 5, authority: 9, directness: 8, pacing: 10, elaboration: 7, conceptualComplexity: 6, perspective: 3, creativity: 8, hookFrequency: 10, sensoryDetail: 7, readerIntimacy: 7, sentenceVariation: 8 },
  adrian: { formality: 8, emotion: 4, warmth: 4, humor: 2, authority: 10, directness: 6, pacing: 4, elaboration: 10, conceptualComplexity: 10, perspective: 7, creativity: 7, hookFrequency: 5, sensoryDetail: 4, readerIntimacy: 4, sentenceVariation: 9 },
  ethan: { formality: 4, emotion: 8, warmth: 7, humor: 7, authority: 5, directness: 7, pacing: 10, elaboration: 6, conceptualComplexity: 6, perspective: 2, creativity: 9, hookFrequency: 10, sensoryDetail: 10, readerIntimacy: 8, sentenceVariation: 9 },
  julian: { formality: 7, emotion: 9, warmth: 5, humor: 2, authority: 7, directness: 5, pacing: 6, elaboration: 9, conceptualComplexity: 9, perspective: 7, creativity: 10, hookFrequency: 9, sensoryDetail: 9, readerIntimacy: 7, sentenceVariation: 10 },
  luca: { formality: 5, emotion: 7, warmth: 8, humor: 6, authority: 6, directness: 6, pacing: 5, elaboration: 8, conceptualComplexity: 7, perspective: 4, creativity: 8, hookFrequency: 6, sensoryDetail: 10, readerIntimacy: 8, sentenceVariation: 8 },
};
// New real-author writers start from the closest existing baseline (sliders stay bounded ±2 per book).
for (const [id, base] of Object.entries({"vivian": "marcus", "rafe": "marcus", "simon": "adrian", "harriet": "marcus", "edmund": "julian", "margaret": "sophia", "henri": "sophia", "lena": "sophia", "rose": "sophia", "nikolai": "sophia", "jack": "marcus", "thomas": "ethan", "amara": "sophia", "charlotte": "sophia", "bella": "sophia", "niamh": "sophia", "orson": "julian", "zane": "julian"} as Record<string, string>)) WRITER_BASELINES[id] = { ...WRITER_BASELINES[base]! };


/** Effective values for a book: requested sliders bounded to the writer baseline ±MAX_ADJUST. */
// deno-lint-ignore no-explicit-any
export function effectiveSlidersFor(book: { book_type?: string; bookType?: string; tone_profile?: any; toneProfile?: any; controls?: any }): SliderValues {
  const writer = resolveWriter(book.controls ?? {}, book.book_type ?? book.bookType ?? null);
  const requested = readSliders(book.tone_profile ?? book.toneProfile, book.controls);
  const base = WRITER_BASELINES[writer.id];
  return base ? boundAll(base, requested) : requested;
}

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
