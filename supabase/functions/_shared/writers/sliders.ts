// 15-slider Expression Control Layer (pure, shared by browser + backend).
// Sliders shape expression only; they never override writer identity / Style Fingerprint.
// Story Divergence is NOT a slider (narrative/canon behaviour) — see DivergenceMode.

export type SliderKey =
  | "formality" | "emotion" | "warmth" | "humor" | "authority" | "directness"
  | "pacing" | "elaboration" | "conceptualComplexity" | "perspective"
  | "creativity" | "hookFrequency" | "sensoryDetail" | "readerIntimacy" | "sentenceVariation";

export interface SliderDef { key: SliderKey; label: string; low: string; high: string; hint: string; group: "tone" | "dynamism"; }

export const SLIDERS: SliderDef[] = [
  { key: "formality", label: "Formality", low: "Casual", high: "Formal", hint: "Casual vs. formal language", group: "tone" },
  { key: "emotion", label: "Emotion", low: "Restrained", high: "Intense", hint: "Emotional intensity (not friendliness)", group: "tone" },
  { key: "warmth", label: "Warmth", low: "Cool", high: "Warm", hint: "Compassion and personability", group: "tone" },
  { key: "humor", label: "Humor", low: "Serious", high: "Playful", hint: "Serious vs. playful expression", group: "tone" },
  { key: "authority", label: "Authority", low: "Humble", high: "Expert", hint: "Tentative vs. confident, expert voice", group: "tone" },
  { key: "directness", label: "Directness", low: "Indirect", high: "Direct", hint: "Diplomatic/indirect vs. blunt/direct", group: "tone" },
  { key: "readerIntimacy", label: "Reader Intimacy", low: "Distant", high: "Close", hint: "How directly the writer relates to the reader", group: "tone" },
  { key: "pacing", label: "Pacing / Velocity", low: "Slow & Deep", high: "Fast & Dynamic", hint: "Speed of plot or idea progression", group: "dynamism" },
  { key: "elaboration", label: "Elaboration / Breadth", low: "Concise", high: "Expansive", hint: "Concise vs. expansive treatment", group: "dynamism" },
  { key: "conceptualComplexity", label: "Conceptual Complexity", low: "Simple", high: "Layered", hint: "How sophisticated or technical ideas are", group: "dynamism" },
  { key: "perspective", label: "Perspective / Thread Complexity", low: "Single Focus", high: "Multi-Thread", hint: "Single focus vs. multiple perspectives/threads", group: "dynamism" },
  { key: "creativity", label: "Creativity", low: "Conservative", high: "Experimental", hint: "Conservative vs. experimental expression", group: "dynamism" },
  { key: "hookFrequency", label: "Hook Frequency", low: "Contemplative", high: "Rapid-Fire", hint: "How often openings/transitions grab attention", group: "dynamism" },
  { key: "sensoryDetail", label: "Sensory Detail", low: "Sparse", high: "Vivid", hint: "Sight, sound, taste, touch, smell", group: "dynamism" },
  { key: "sentenceVariation", label: "Sentence Variation", low: "Uniform", high: "Varied", hint: "Sentence length, rhythm and structure", group: "dynamism" },
];

export type SliderValues = Record<SliderKey, number>;
export const MAX_ADJUST = 2;
export const NEUTRAL: SliderValues = Object.fromEntries(SLIDERS.map((s) => [s.key, 5])) as SliderValues;

export type DivergenceMode = "strict" | "controlled" | "open";
export const DIVERGENCE_OPTIONS: { value: DivergenceMode; label: string; description: string }[] = [
  { value: "strict", label: "Strict", description: "Follow the outline and established canon exactly" },
  { value: "controlled", label: "Controlled", description: "Small deviations allowed if they serve the outline and canon" },
  { value: "open", label: "Open", description: "Threads may diverge and reconverge; canon still protected" },
];

const clamp = (n: number, lo = 1, hi = 10) => Math.min(hi, Math.max(lo, Math.round(n)));
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? clamp(v) : d);

type AnyRec = Record<string, unknown> | null | undefined;

/** Read all 15 values from a book's toneProfile/controls, mapping legacy field names. Missing new sliders = 5. */
export function readSliders(tone: AnyRec, controls: AnyRec): SliderValues {
  const t = tone ?? {}, c = controls ?? {};
  return {
    formality: num(t.formality, 5),
    emotion: num(t.emotionalIntensity, 5),
    warmth: num(t.warmth, 5),
    humor: num(t.humorLevel, 5),
    authority: num(t.authorityLevel, 5),
    directness: num(t.directness, 5),
    readerIntimacy: num(t.readerIntimacy, 5),
    pacing: num(c.velocity, 5),
    elaboration: num(c.scope, 5),
    conceptualComplexity: num(c.entityComplexity, 5),
    perspective: num(c.perspectiveMultiplexing, 3),
    creativity: num(c.creativity, 5),
    hookFrequency: num(c.hookFrequency, 5),
    sensoryDetail: num(c.sensoryDetail, 5),
    sentenceVariation: num(c.sentenceVariation, 5),
  };
}

/** Bound an effective value to baseline ±MAX_ADJUST (and 1–10). */
export function boundToBaseline(baseline: number, value: number): number {
  return clamp(clamp(value, baseline - MAX_ADJUST, baseline + MAX_ADJUST));
}

export function boundAll(baseline: SliderValues, effective: Partial<SliderValues>): SliderValues {
  const out = { ...baseline };
  for (const s of SLIDERS) if (typeof effective[s.key] === "number") out[s.key] = boundToBaseline(baseline[s.key], effective[s.key]!);
  return out;
}

/** Legacy boolean → mode. Explicit mode wins. */
export function resolveDivergence(controls: AnyRec): DivergenceMode {
  const m = controls?.divergenceMode;
  if (m === "strict" || m === "controlled" || m === "open") return m;
  return controls?.divergenceAllowed ? "open" : "strict";
}

const band = (v: number) => (v <= 3 ? "low" : v >= 8 ? "high" : v >= 6 ? "moderately high" : "moderate");

/** Deterministic prompt block (prompt-cache safe). */
export function renderExpressionBlock(v: SliderValues, divergence: DivergenceMode): string {
  const lines = SLIDERS.map((s) => `- ${s.label}: ${v[s.key]}/10 (${band(v[s.key])}; ${s.low} ↔ ${s.high})`);
  const div = DIVERGENCE_OPTIONS.find((d) => d.value === divergence)!;
  return `EXPRESSION CONTROLS (adjust expression only; never override the writer's identity, Style Fingerprint, vocabulary boundaries or avoid list):
${lines.join("\n")}
STORY DIVERGENCE: ${div.label} — ${div.description}.`;
}
