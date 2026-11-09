export const REFERENCE_VIEWS = ['full-length front', 'full-length side', 'full-length back', 'close-up front', 'close-up side'] as const;
export interface CharacterLock {
  referencePath: string; heightCm: number; weightKg: number;
  measurementSource: 'author' | 'designed'; features: Record<string,string>;
  tells: { state: string; cue: string; purpose: 'betray'|'assist'|'reveal'|'endanger'|'mislead'|'comfort'; sharedReason?: string }[];
  desireLine: string; heldBackFeature: string; locked: boolean;
}
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function validateCharacterLock(card: CharacterLock, others: CharacterLock[] = []): string[] {
  const issues: string[] = [];
  if (!card.referencePath) issues.push('Five-view reference required');
  if (!['author','designed'].includes(card.measurementSource)) issues.push('Measurement provenance required');
  if (!card.features || Object.keys(card.features).length === 0) issues.push('Image-observed features required');
  if (!Number.isFinite(card.heightCm) || card.heightCm <= 0 || !Number.isFinite(card.weightKg) || card.weightKg <= 0) issues.push('Exact designed or author-provided height and weight required');
  if (card.tells.length < 4 || card.tells.length > 10) issues.push('Four to ten behavioural tells required');
  if (!card.tells.some(t => t.state === 'at-ease')) issues.push('At-ease tell required');
  const seen = new Set<string>();
  for (const t of card.tells) {
    if (!t.cue?.trim() || !['betray','assist','reveal','endanger','mislead','comfort'].includes(t.purpose)) issues.push('Functional tell required');
    const key = norm(t.cue);
    if (seen.has(key)) issues.push('Duplicate tell on this card'); seen.add(key);
    if (!t.sharedReason && others.some(c => c.tells.some(x => norm(x.cue) === key))) issues.push('Shared tell needs a story explanation');
  }
  if (!card.desireLine?.trim() || !card.heldBackFeature?.trim()) issues.push('Desire line and held-back signature required');
  return issues;
}
export function referencePrompt(name: string, role: string, direction: string) {
  return `One realistic consistent character reference composite for ${name}, role: ${role}. Five unobstructed panels of THE SAME PERSON: ${REFERENCE_VIEWS.join('; ')}. Neutral plain background, consistent clothes, face, body and lighting, no labels or text. Respect the character's specified gender presentation; do not infer gender from occupation or strength. Direction: ${direction}`;
}
export function introductionCueCount(absentChapters: number, previousBook = false): [number, number] {
  return previousBook ? [5,7] : absentChapters <= 1 ? [1,1] : [2,3];
}
/** Per-character re-entry cue plan for the section being drafted. `lastChapterByName`
 *  maps a normalized character name to the last accepted chapter where they appeared.
 *  Absent from the map = first introduction in this book ([5,7] via previousBook or the
 *  full introduction handled by the intro rules). */
export function reentryCuePlans(names: readonly string[], lastChapterByName: Readonly<Record<string, number>>, currentChapter: number, previousBookNames: ReadonlySet<string> = new Set()): { name: string; range: [number, number]; kind: 'introduction' | 're-entry' }[] {
  return names.map(name => {
    const key = norm(name);
    const last = lastChapterByName[key];
    if (last == null) return { name, range: [5, 7] as [number, number], kind: 'introduction' as const };
    return { name, range: introductionCueCount(currentChapter - last, false), kind: 're-entry' as const };
  });
}
export function selectUnspentFeatures(features: string[], spentThisScene: string[], heldBack?: string): string[] {
  const spent = new Set(spentThisScene.map(norm));
  return features.filter(f => !spent.has(norm(f)) && (!heldBack || norm(f) !== norm(heldBack)));
}
export function applyLockedFeature(card: CharacterLock, key: string, value: string): { card: CharacterLock; conflict: boolean } {
  if (card.locked && card.features[key] && norm(card.features[key]) !== norm(value)) return { card, conflict: true };
  return { card: { ...card, features: { ...card.features, [key]: value } }, conflict: false };
}