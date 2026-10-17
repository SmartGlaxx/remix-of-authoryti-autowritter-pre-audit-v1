// Stage A contracts for the Writing Naturalness Engine. Pure, no I/O, no analysis yet (Stage B).

export type NaturalnessMode = "off" | "analyze_only" | "advise";
export const DEFAULT_NATURALNESS_MODE: NaturalnessMode = "off";

/** Reads books.controls.naturalness; anything missing or unknown = "off". */
export function resolveNaturalnessMode(controls: unknown): NaturalnessMode {
  const v = (controls as { naturalness?: unknown } | null | undefined)?.naturalness;
  return v === "analyze_only" || v === "advise" ? v : "off";
}

export type NaturalnessCategory =
  | "opening_recurrence" | "figurative_density" | "burstiness"
  | "dialogue_contradiction" | "mechanical_pattern";

export interface NaturalnessFinding {
  category: NaturalnessCategory;
  severity: "info" | "advisory";
  message: string;
  evidence: Record<string, unknown>;
}

/** Guardrail: stylistic findings never block acceptance, whatever the mode. */
export function naturalnessBlocksAcceptance(_findings: NaturalnessFinding[]): false {
  return false;
}

/** Coerces any severity to advisory-or-lower so nothing can escalate to material. */
export function clampSeverity(s: string): "info" | "advisory" {
  return s === "info" ? "info" : "advisory";
}

export type ArtifactType = "motif" | "scenery" | "title_plan" | "verbal_motif" | "sensory_palette";

export interface StyleAdaptation {
  writerId: string;
  dimension: string;
  adjustment: Record<string, unknown>;
  status: "proposed" | "active" | "reverted";
}

/** Overlays active adaptations on a copy; the base profile object is never mutated. */
export function applyAdaptations<T extends object>(base: T, adaptations: StyleAdaptation[]): T & { adaptations: StyleAdaptation[] } {
  const active = adaptations.filter((a) => a.status === "active");
  return { ...structuredClone(base), adaptations: active };
}
