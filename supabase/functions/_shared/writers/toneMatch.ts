// Tone ↔ Writer harmony (pure, shared by browser + backend).
// The book's tone sets the mood; the writer is the lens. A tone recommends the best-fitting writer,
// nudges sliders only within the writer's baseline ±MAX_ADJUST, and explains how each writer
// interprets the tone — writers never break character to hit a tone.
import { WRITER_PERSONAS, getWriter, bestWriterFor, type WriterPersona } from "./personas.ts";
import { WRITER_BASELINES } from "./manifest.ts";
import { boundToBaseline, NEUTRAL, type SliderKey, type SliderValues } from "./sliders.ts";

export const BOOK_TONES = ["Dark", "Hopeful", "Funny", "Suspenseful", "Romantic", "Literary", "Cozy", "Gritty", "Inspiring", "Practical", "Authoritative", "Conversational"] as const;

/** Slider targets (1–10) that express each tone. Only the sliders that define the mood are listed. */
export const TONE_TARGETS: Record<string, Partial<SliderValues>> = {
  Dark: { emotion: 8, warmth: 3, humor: 2, sensoryDetail: 7 },
  Hopeful: { warmth: 8, emotion: 7, humor: 5 },
  Funny: { humor: 9, warmth: 7, formality: 3, pacing: 7 },
  Suspenseful: { pacing: 8, hookFrequency: 9, emotion: 7, humor: 3 },
  Romantic: { emotion: 8, warmth: 8, sensoryDetail: 8, readerIntimacy: 7 },
  Literary: { sentenceVariation: 9, conceptualComplexity: 8, creativity: 8, pacing: 4 },
  Cozy: { warmth: 9, humor: 6, pacing: 4, emotion: 5 },
  Gritty: { directness: 8, warmth: 3, sensoryDetail: 8, formality: 4 },
  Inspiring: { emotion: 8, warmth: 8, authority: 7, readerIntimacy: 8 },
  Practical: { directness: 8, authority: 7, elaboration: 5, creativity: 4 },
  Authoritative: { authority: 9, formality: 8, directness: 7 },
  Conversational: { formality: 3, readerIntimacy: 9, warmth: 7 },
};

export type ToneFit = "natural" | "adapts" | "stretch";
export interface ToneMatch {
  writerId: string; tone: string; fit: ToneFit;
  /** Average distance (after the ±2 nudge) between what the tone wants and what this writer can reach. */
  gap: number;
  /** Plain-language reason shown to the author. */
  reason: string;
  /** How this writer's voice renders the tone. */
  lens: string;
}

const LABEL: Record<SliderKey, string> = {
  formality: "formality", emotion: "emotional intensity", warmth: "warmth", humor: "humour", authority: "authority", directness: "directness",
  pacing: "pace", elaboration: "depth", conceptualComplexity: "complexity", perspective: "threads", creativity: "creativity",
  hookFrequency: "hooks", sensoryDetail: "sensory detail", readerIntimacy: "closeness to the reader", sentenceVariation: "sentence rhythm",
};

function baselineOf(id: string): SliderValues { return WRITER_BASELINES[id] ?? NEUTRAL; }

/** Sliders for this writer leaning toward the tone, never beyond baseline ±2. Other sliders keep the baseline. */
export function tonePreset(writerId: string, tone: string | null | undefined): SliderValues {
  const base = baselineOf(writerId);
  const out = { ...base };
  const t = tone ? TONE_TARGETS[tone] : undefined;
  if (t) for (const [k, v] of Object.entries(t)) out[k as SliderKey] = boundToBaseline(base[k as SliderKey], v as number);
  return out;
}

export function matchWriterToTone(writerId: string, tone: string | null | undefined): ToneMatch | null {
  const w = getWriter(writerId);
  const t = tone ? TONE_TARGETS[tone] : undefined;
  if (!w || !t || !tone) return null;
  const base = baselineOf(w.id);
  const reached = tonePreset(w.id, tone);
  const diffs = Object.entries(t).map(([k, v]) => ({ k: k as SliderKey, want: v as number, base: base[k as SliderKey], gap: Math.abs((v as number) - reached[k as SliderKey]) }));
  const gap = Math.round((diffs.reduce((s, d) => s + d.gap, 0) / diffs.length) * 10) / 10;
  const fit: ToneFit = gap <= 0.75 ? "natural" : gap <= 2 ? "adapts" : "stretch";
  const first = w.name.split(" ")[0];
  const strong = diffs.filter((d) => d.gap === 0).map((d) => LABEL[d.k]);
  const weak = diffs.filter((d) => d.gap >= 2).sort((a, b) => b.gap - a.gap).map((d) => `${LABEL[d.k]} (${d.want > d.base ? "naturally lower" : "naturally higher"})`);
  const reason = fit === "natural"
    ? `${first}'s natural voice already carries a ${tone.toLowerCase()} tone${strong.length ? ` — ${strong.slice(0, 3).join(", ")} sit right where this tone needs them` : ""}.`
    : fit === "adapts"
      ? `${first} can lean into a ${tone.toLowerCase()} tone within their own style${weak.length ? `, though their ${weak.slice(0, 2).join(" and ")} keeps it subtler` : ""}.`
      : `${first}'s voice resists a fully ${tone.toLowerCase()} tone${weak.length ? ` — their ${weak.slice(0, 2).join(" and ")} cannot move far enough` : ""}. They stay in character, so expect a muted version.`;
  return { writerId: w.id, tone, fit, gap, reason, lens: lensFor(w, tone) };
}

/** How a specific writer renders a tone, built from their own persona traits. */
export function lensFor(w: WriterPersona, tone: string): string {
  const first = w.name.split(" ")[0];
  const humorTones = ["Funny", "Cozy", "Conversational"];
  const trait = humorTones.includes(tone) ? `humour: ${w.humor.replace(/\.$/, "").toLowerCase()}`
    : ["Dark", "Gritty", "Suspenseful"].includes(tone) ? `temperament: ${w.temperament.replace(/\.$/, "").toLowerCase()}`
    : ["Romantic", "Hopeful", "Inspiring"].includes(tone) ? `reader relationship: ${w.readerRelationship.replace(/\.$/, "").toLowerCase()}`
    : `rhythm: ${w.rhythm.replace(/\.$/, "").toLowerCase()}`;
  return `${first} expresses "${tone}" through their ${trait}; signature: ${w.signature.replace(/\.$/, "").toLowerCase()}.`;
}

/** Best writer for a tone: book-type specialists first, then the smallest tone gap. No tone = book-type best fit. */
export function recommendWriterForTone(tone: string | null | undefined, bookType: string | null | undefined): WriterPersona {
  if (!tone || !TONE_TARGETS[tone]) return bestWriterFor(bookType);
  const score = (w: WriterPersona) => {
    const m = matchWriterToTone(w.id, tone)!;
    const idx = bookType ? w.bookTypes.indexOf(bookType) : -1;
    return m.gap + (idx < 0 ? 2.5 : idx * 0.2);
  };
  return [...WRITER_PERSONAS].sort((a, b) => score(a) - score(b))[0];
}

/** Voice block for idea/variant prompts: everything the author reads is written as this writer would write it. */
export function ideationVoiceBlock(writerId: string, tone: string | null | undefined): string {
  const w = getWriter(writerId);
  if (!w) return "";
  const m = matchWriterToTone(w.id, tone);
  return [
    `WRITER VOICE — write every title, logline, summary, twist and ending exactly as ${w.name} (${w.tagline}) would write them.`,
    `Communication: ${w.communication} Vocabulary: ${w.vocabulary} Rhythm: ${w.rhythm}`,
    `Humour: ${w.humor} Imagery: ${w.figurative} Storytelling: ${w.storytelling}`,
    `Avoids: ${w.avoids} Signature: ${w.signature}`,
    m ? `Book tone: ${tone}. ${m.lens} Never break this writer's character to force the tone.` : "",
    "The voice shapes wording only; it never changes facts, structure, the required JSON or the author's requirements.",
  ].filter(Boolean).join("\n");
}
