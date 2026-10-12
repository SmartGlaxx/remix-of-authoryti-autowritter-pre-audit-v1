export const MAX_PORTRAIT_OPTIONS = 5;
export function portraitOptionCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_PORTRAIT_OPTIONS ? value : null;
}
/** Soft demotion preserves every profile field and all book links. */
export function personaLibraryState(demoted: boolean) {
  return { is_archived: demoted };
}