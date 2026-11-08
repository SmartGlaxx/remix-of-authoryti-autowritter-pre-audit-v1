// Paragraph-level temporal anchors and non-linear frame validation. Pure logic (no I/O).
// Shared by extraction, continuity and tests.
//
// Two kinds of time in prose:
// - RELATIVE: pegged to something else ("five hours later", "the next morning", "that same day").
//   Cannot stand alone; it advances the clock of the frame it appears in.
// - RAW / EXACT: a fixed clock or calendar stamp ("7:00 PM", "29th June", "at noon").
//   Points at an absolute coordinate directly.
// A paragraph may carry one, the other, both, or neither. When both appear, the arithmetic
// must agree: noon + "five hours later" cannot read "7:00 PM".
//
// Non-linear storytelling (flashbacks, in-mind memories, flashforwards, parallel action)
// opens a named FRAME with its own clock. The linear "main" clock freezes while a frame is
// open and resumes where it left off when the scene snaps back — so legitimate time jumps
// never trigger false chronological errors, while unmarked jumps are flagged.

export type TemporalFrameType = "linear" | "flashback" | "memory" | "flashforward" | "parallel";

export const FRAME_TYPES: readonly TemporalFrameType[] = ["linear", "flashback", "memory", "flashforward", "parallel"];

export interface ParagraphTimeAnchor {
  paragraphIndex: number;              // 0-based, must match position in the array
  frameType: TemporalFrameType;
  frameId: string;                     // "main" for linear; a stable name for each non-linear frame
  relativeTime: string | null;         // verbatim relative phrase from the paragraph, or null
  rawTime: string | null;              // verbatim raw/exact phrase from the paragraph, or null
  parentReturnIndex: number | null;    // paragraph index where an open non-linear frame returns, else null
}

export interface TemporalFinding {
  paragraphIndex: number;
  kind: "clock_contradiction" | "reverse_clock" | "unanchored_jump" | "unanchored_frame";
  detail: string;
}

// ── Clock parsing ────────────────────────────────────────────────────────────
// Absolute times are tracked as minutes from an arbitrary day-zero midnight, so
// relative advances can roll across midnight ("8 PM" + "five hours later" = 1 AM next day).

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
};

/** Minutes of day for a raw/exact phrase, or null when it names no resolvable clock point. */
export function parseRawTimeOfDay(raw: string): number | null {
  const t = raw.toLowerCase().replace(/\./g, "").trim();
  const m = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(t);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3] === "pm") h += 12;
    return h * 60 + Number(m[2] ?? 0);
  }
  if (/\b(24[- ]?hour|o'?clock)\b/.test(t)) {
    const h24 = /\b(\d{1,2})(?::(\d{2}))?\s*(?:o'?clock|h)/.exec(t);
    if (h24) { const h = Number(h24[1]); if (h <= 23) return h * 60 + Number(h24[2] ?? 0); }
  }
  if (/\b(noon|midday)\b/.test(t)) return 720;
  if (/\bmidnight\b/.test(t)) return 0;
  if (/\b(dawn|sunrise|first light)\b/.test(t)) return 360;
  if (/\b(dusk|sunset|nightfall)\b/.test(t)) return 1080;
  return null;
}

export interface RelativeShift {
  minutes: number | null;   // exact elapsed minutes when the phrase gives a duration
  dayAdvance: boolean;      // phrase moves to a later day without an exact duration
  markerOnly: boolean;      // anchors the transition but gives no computable shift
}

/** How a relative phrase moves the clock. Unresolvable phrases are markers, never guesses. */
export function parseRelativeShift(relative: string): RelativeShift | null {
  const t = relative.toLowerCase().trim();
  if (!t) return null;
  if (/\bhalf an?\s+(hour|day|week)\s+(later|on)\b/.test(t)) return { minutes: t.includes("hour") ? 30 : t.includes("day") ? 720 : 5040, dayAdvance: false, markerOnly: false };
  const dur = /\b([a-z]+|\d+(?:\.\d+)?)\s*(half\s+an\s+)?(minutes?|hours?|days?|weeks?)\s+(later|after|on|hence)\b/.exec(t)
    ?? /\b(?:in|within)\s+([a-z]+|\d+(?:\.\d+)?)\s*(half\s+an\s+)?(minutes?|hours?|days?|weeks?)\b/.exec(t);
  if (dur) {
    const n = WORD_NUMBERS[dur[1]] ?? (Number.isFinite(Number(dur[1])) ? Number(dur[1]) : null);
    if (n != null) {
      const unit = dur[3][0];
      const base = unit === "m" ? 1 : unit === "h" ? 60 : unit === "d" ? 1440 : 10080;
      return { minutes: Math.round(n * base + (dur[2] ? base / 2 : 0)), dayAdvance: false, markerOnly: false };
    }
    return { minutes: null, dayAdvance: false, markerOnly: true }; // "a few hours later"
  }
  if (/\bthe (next|following) (day|morning|afternoon|evening|night)\b/.test(t) || /\bthat (night|evening)\b/.test(t) && /\b(next|following)\b/.test(t))
    return { minutes: null, dayAdvance: true, markerOnly: true };
  if (/\b(later that (day|night|afternoon|evening|morning)|that same (day|night|morning|afternoon|evening)|moments? later|shortly after|soon after|by (dusk|dawn|noon|midnight|sunset|sunrise)|earlier that (day|morning))\b/.test(t))
    return { minutes: null, dayAdvance: false, markerOnly: true };
  return { minutes: null, dayAdvance: false, markerOnly: true };
}

/** Raw phrase + current absolute clock → candidate absolute minutes (day inferred as the current day). */
function rawToAbsolute(rawMinutes: number, current: number | null): number {
  if (current == null) return rawMinutes;
  const day = Math.floor(current / 1440);
  return day * 1440 + rawMinutes;
}

/** Tolerance for comparing prose durations against stated clock times ("about an hour later"). */
export const CLOCK_TOLERANCE_MINUTES = 45;

// ── Frame validation ─────────────────────────────────────────────────────────

interface FrameState { clock: number | null; seen: boolean }

/**
 * Deterministically re-derives every frame's clock from the anchors (the model's own
 * resolvedClock is never trusted) and reports only demonstrable problems:
 * - clock_contradiction: relative shift and raw time in the same paragraph disagree.
 * - reverse_clock: a frame's clock provably moves backwards (rollovers across midnight allowed).
 * - unanchored_jump: the LINEAR frame's clock jumps with no relative marker and no frame change.
 * - unanchored_frame: a non-linear frame opens with neither a raw nor a relative anchor.
 * Frames never contradict each other: a flashback's 2019 sits beside today's 5 PM freely.
 */
export function validateTemporalFrames(anchors: ParagraphTimeAnchor[]): TemporalFinding[] {
  const findings: TemporalFinding[] = [];
  const frames = new Map<string, FrameState>();
  const state = (id: string): FrameState => {
    let s = frames.get(id);
    if (!s) { s = { clock: null, seen: false }; frames.set(id, s); }
    return s;
  };
  let prev: ParagraphTimeAnchor | null = null;
  for (const a of anchors) {
    const id = a.frameType === "linear" ? "main" : a.frameId;
    const frame = state(id);
    const frameReturn = a.frameType === "linear" && prev != null && prev.frameType !== "linear";
    const raw = a.rawTime ? parseRawTimeOfDay(a.rawTime) : null;
    const shift = a.relativeTime ? parseRelativeShift(a.relativeTime) : null;

    if (!frame.seen) {
      frame.seen = true;
      if (a.frameType !== "linear" && raw == null && !shift)
        findings.push({ paragraphIndex: a.paragraphIndex, kind: "unanchored_frame", detail: `Frame "${id}" opens with neither a raw nor a relative time anchor.` });
    }

    let candidate: number | null = null;
    if (raw != null) candidate = rawToAbsolute(raw, frame.clock);
    if (shift?.minutes != null && frame.clock != null) {
      const shifted = frame.clock + shift.minutes;
      if (candidate != null) {
        if (Math.abs(shifted - candidate) > CLOCK_TOLERANCE_MINUTES && Math.abs(shifted - candidate - 1440) > CLOCK_TOLERANCE_MINUTES)
          findings.push({ paragraphIndex: a.paragraphIndex, kind: "clock_contradiction", detail: `"${a.relativeTime}" from the previous position gives ${fmt(shifted)}, but the paragraph states "${a.rawTime}" (${fmt(candidate)}).` });
        candidate = shifted; // the elapsed shift is the more reliable narrative motion
      } else candidate = shifted;
    } else if (shift?.dayAdvance) {
      const day = frame.clock == null ? 0 : Math.floor(frame.clock / 1440) + 1;
      candidate = day * 1440 + (raw ?? 0);
    }

    if (candidate != null && frame.clock != null && candidate < frame.clock) {
      if (shift || a.frameType !== "linear" || frameReturn)
        findings.push({ paragraphIndex: a.paragraphIndex, kind: "reverse_clock", detail: `Clock moves backwards inside frame "${id}": ${fmt(frame.clock)} then ${fmt(candidate)}.` });
      else
        findings.push({ paragraphIndex: a.paragraphIndex, kind: "unanchored_jump", detail: `Linear scene jumps from ${fmt(frame.clock)} to ${fmt(candidate)} with no transition marker ("the next day", "meanwhile", a flashback cue…).` });
    }
    if (candidate != null) frame.clock = candidate;
    prev = a;
  }
  return findings;
}

const fmt = (abs: number): string => {
  const day = Math.floor(abs / 1440);
  const mins = ((abs % 1440) + 1440) % 1440;
  const h = Math.floor(mins / 60), m = mins % 60;
  const suffix = h % 24 >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, "0")} ${suffix}${day > 0 ? ` (day ${day + 1})` : ""}`;
};

// ── Chapter time-mix rules ───────────────────────────────────────────────────
// Per chapter: 4–8 temporal references total. The mix is fractional — the per-10
// figures are proportions of the actual total (which may be 12, 15, 18, 20…), not
// a literal count of ten:
//   relative alone  4–6 of 10  (40–60%)
//   raw alone       1–3 of 10  (10–30%)
//   both combined   2–4 of 10  (20–40%)

export interface TimeMix { relativeOnly: number; rawOnly: number; combined: number }

export interface TimeMixAssessment {
  total: number;
  totalOK: boolean;          // 4–8 references per chapter
  relativeShareOK: boolean;  // 40–60%
  rawShareOK: boolean;       // 10–30%
  combinedShareOK: boolean;  // 20–40%
}

export function timeMixAssessment(mix: TimeMix): TimeMixAssessment {
  const total = mix.relativeOnly + mix.rawOnly + mix.combined;
  const share = (n: number) => (total > 0 ? n / total : 0);
  return {
    total,
    totalOK: total >= 4 && total <= 8,
    relativeShareOK: total > 0 && share(mix.relativeOnly) >= 0.4 && share(mix.relativeOnly) <= 0.6,
    rawShareOK: total > 0 && share(mix.rawOnly) >= 0.1 && share(mix.rawOnly) <= 0.3,
    combinedShareOK: total > 0 && share(mix.combined) >= 0.2 && share(mix.combined) <= 0.4,
  };
}

/** Classify the anchors of one chapter into the mix buckets. */
export function mixOf(anchors: ParagraphTimeAnchor[]): TimeMix {
  const mix: TimeMix = { relativeOnly: 0, rawOnly: 0, combined: 0 };
  for (const a of anchors) {
    const hasRel = !!a.relativeTime, hasRaw = !!a.rawTime;
    if (hasRel && hasRaw) mix.combined++;
    else if (hasRel) mix.relativeOnly++;
    else if (hasRaw) mix.rawOnly++;
  }
  return mix;
}
