// Pure chronology + temporal-knowledge contracts (Persona Studio Phase 1).
// Shared by browser, edge functions and tests. No I/O.
//
// Dates are stored as ApproximateDate JSON. Every date resolves to an inclusive
// day-level interval [earliest, latest]; comparisons use interval logic so
// uncertainty is never collapsed into a fabricated exact date.

export type DatePrecision =
  | "exact"        // year + month + day
  | "month_year"   // year + month
  | "year"         // year only
  | "approximate"  // ~year with a tolerance in years
  | "range"        // explicit from/to
  | "disputed"     // several claims; canon value may be unknown
  | "unknown";

export interface DayPoint { year: number; month: number; day: number }

export interface ApproximateDate {
  precision: DatePrecision;
  year?: number;
  month?: number;          // 1-12
  day?: number;            // 1-31
  toleranceYears?: number; // approximate only (default 2)
  from?: Partial<DayPoint> & { year: number };
  to?: Partial<DayPoint> & { year: number };
  rawText?: string;
  disputedClaims?: Array<{ sourceIdentityId?: string; claim: ApproximateDate; claimType: "belief" | "deception" | "memory" }>;
}

export interface DateInterval { earliest: DayPoint; latest: DayPoint }

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const lo = (p: Partial<DayPoint> & { year: number }): DayPoint => ({ year: p.year, month: p.month ?? 1, day: p.day ?? 1 });
const hi = (p: Partial<DayPoint> & { year: number }): DayPoint => {
  const month = p.month ?? 12;
  return { year: p.year, month, day: p.day ?? daysInMonth(p.year, month) };
};

export function cmpDay(a: DayPoint, b: DayPoint): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/** Interval for a date, or null when nothing is known. Disputed dates widen to cover every claim. */
export function toInterval(d: ApproximateDate | null | undefined): DateInterval | null {
  if (!d) return null;
  switch (d.precision) {
    case "exact":
      if (d.year == null || d.month == null || d.day == null) return null;
      return { earliest: { year: d.year, month: d.month, day: d.day }, latest: { year: d.year, month: d.month, day: d.day } };
    case "month_year":
      if (d.year == null || d.month == null) return null;
      return { earliest: lo({ year: d.year, month: d.month }), latest: hi({ year: d.year, month: d.month }) };
    case "year":
      if (d.year == null) return null;
      return { earliest: lo({ year: d.year }), latest: hi({ year: d.year }) };
    case "approximate": {
      if (d.year == null) return null;
      const t = Math.max(0, d.toleranceYears ?? 2);
      return { earliest: lo({ year: d.year - t }), latest: hi({ year: d.year + t }) };
    }
    case "range":
      if (!d.from || !d.to) return null;
      return { earliest: lo(d.from), latest: hi(d.to) };
    case "disputed": {
      const parts = (d.disputedClaims ?? []).map((c) => toInterval(c.claim)).filter(Boolean) as DateInterval[];
      if (d.year != null) parts.push(toInterval({ precision: "year", year: d.year })!);
      if (!parts.length) return null;
      return {
        earliest: parts.reduce((m, p) => (cmpDay(p.earliest, m) < 0 ? p.earliest : m), parts[0].earliest),
        latest: parts.reduce((m, p) => (cmpDay(p.latest, m) > 0 ? p.latest : m), parts[0].latest),
      };
    }
    default:
      return null;
  }
}

export function isExact(d: ApproximateDate | null | undefined): boolean {
  return !!d && d.precision === "exact" && d.year != null && d.month != null && d.day != null;
}

/** Whole years between two exact days, respecting month and day (birthday boundary). */
function yearsBetween(birth: DayPoint, at: DayPoint): number {
  let age = at.year - birth.year;
  if (at.month < birth.month || (at.month === birth.month && at.day < birth.day)) age -= 1;
  return age;
}

export interface AgeResult { minAge: number; maxAge: number; exact: boolean; known: boolean }

/** Age at a story date. Exact when both dates are exact; otherwise a bounded range. */
export function ageAt(birth: ApproximateDate | null | undefined, at: ApproximateDate | null | undefined): AgeResult {
  const b = toInterval(birth);
  const a = toInterval(at);
  if (!b || !a) return { minAge: 0, maxAge: 0, exact: false, known: false };
  const minAge = yearsBetween(b.latest, a.earliest);
  const maxAge = yearsBetween(b.earliest, a.latest);
  return { minAge, maxAge, exact: minAge === maxAge && isExact(birth) && isExact(at), known: true };
}

export type ChronoVerdict = "ok" | "uncertain" | "violation" | "unknown";

/** Must `before` happen no later than `after`? Violation only when demonstrable. */
export function checkOrder(before: ApproximateDate | null | undefined, after: ApproximateDate | null | undefined): ChronoVerdict {
  const b = toInterval(before);
  const a = toInterval(after);
  if (!b || !a) return "unknown";
  if (cmpDay(b.earliest, a.latest) > 0) return "violation";
  if (cmpDay(b.latest, a.earliest) <= 0) return "ok";
  return "uncertain";
}

/** Does a stated age in prose fit the canonical birth date at this story date? */
export function checkStatedAge(stated: number, birth: ApproximateDate | null | undefined, at: ApproximateDate | null | undefined): ChronoVerdict {
  const r = ageAt(birth, at);
  if (!r.known) return "unknown";
  if (stated < r.minAge || stated > r.maxAge) return "violation";
  return r.exact ? "ok" : "uncertain";
}

export interface Milestone { key: string; date: ApproximateDate | null; requires?: string[] }

export interface ChronoFinding { key: string; requires: string; verdict: "violation" | "uncertain" }

/** Every milestone must not precede the milestones it depends on. */
export function validateMilestones(milestones: Milestone[]): ChronoFinding[] {
  const byKey = new Map(milestones.map((m) => [m.key, m]));
  const out: ChronoFinding[] = [];
  for (const m of milestones) {
    for (const r of m.requires ?? []) {
      const dep = byKey.get(r);
      if (!dep) continue;
      const v = checkOrder(dep.date, m.date);
      if (v === "violation" || v === "uncertain") out.push({ key: m.key, requires: r, verdict: v });
    }
  }
  return out;
}

// ─── Temporal knowledge ─────────────────────────────────────────────────────

export type NarrativeVantage = "immediate" | "retrospective";

/** A story position: story date plus manuscript position (chapter/section) as tie-breaker. */
export interface StoryPoint { date?: ApproximateDate | null; chapterIndex?: number; subsectionIndex?: number }

export interface KnowledgeRecord {
  claim: string;
  identityId: string;
  learned: StoryPoint;          // when THIS character learned it (not when the event happened)
  certainty: "certain" | "suspected" | "disputed" | "false_belief";
  superseded?: StoryPoint | null;
}

export type Reachability = "yes" | "no" | "maybe";

/** Was point `p` reached at or before point `at`? Dates first, manuscript position as fallback. */
export function reachedBy(p: StoryPoint, at: StoryPoint): Reachability {
  const v = checkOrder(p.date ?? null, at.date ?? null);
  if (v === "ok") return "yes";
  if (v === "violation") return "no";
  if (p.chapterIndex != null && at.chapterIndex != null) {
    const a = p.chapterIndex * 10_000 + (p.subsectionIndex ?? 0);
    const b = at.chapterIndex * 10_000 + (at.subsectionIndex ?? 0);
    return a <= b ? "yes" : "no";
  }
  return "maybe";
}

export interface KnowledgeAccess {
  /** May appear as the narrator's in-scene perception/belief. */
  inScene: Reachability;
  /** May appear as retrospective hindsight ("I didn't know it then…"). */
  hindsight: Reachability;
}

/**
 * Narrator access to one knowledge record.
 * - Immediate narration: only what was learned by the scene's story point.
 * - Retrospective narration: scene perception is still bounded by the scene point,
 *   but hindsight may use anything learned by the telling point.
 * Knowledge superseded before the relevant point is no longer held as current.
 */
export function narratorAccess(
  rec: KnowledgeRecord,
  scene: StoryPoint,
  vantage: NarrativeVantage,
  telling?: StoryPoint | null,
): KnowledgeAccess {
  const held = (at: StoryPoint): Reachability => {
    const learned = reachedBy(rec.learned, at);
    if (learned === "no") return "no";
    if (rec.superseded) {
      const gone = reachedBy(rec.superseded, at);
      if (gone === "yes") return "no";
      if (gone === "maybe") return "maybe";
    }
    return learned;
  };
  const inScene = held(scene);
  if (vantage === "immediate" || !telling) return { inScene, hindsight: "no" };
  // Hindsight: learned by the telling point; superseded beliefs may still be recalled as past beliefs.
  return { inScene, hindsight: reachedBy(rec.learned, telling) };
}
