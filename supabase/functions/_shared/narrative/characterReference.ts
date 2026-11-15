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
  if (!card.referencePath) issues.push('Character reference required');
  if (!['author','designed'].includes(card.measurementSource)) issues.push('Measurement provenance required');
  if (!card.features || Object.keys(card.features).length === 0) issues.push('Designed appearance features required');
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
export function reentryCuePlans(names: readonly string[], lastChapterByName: Readonly<Record<string, number>>, currentChapter: number): { name: string; range: [number, number]; kind: 'introduction' | 're-entry' }[] {
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
/** Cast names that still lack a locked reference card (case/space-insensitive name match). */
export function missingReferenceNames(cast: readonly string[], cards: readonly { name?: string; reference?: { locked?: boolean } }[]): string[] {
  const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
  const locked = new Set(cards.filter((c) => c?.reference?.locked && c.name).map((c) => norm(c.name!)));
  return [...new Set(cast.map((n) => n?.trim()).filter(Boolean))].filter((n) => !locked.has(norm(n)));
}

/** Text-only reference: the designed features + 500–700 word dossier replace the image. No paid image or vision call. */
export const TEXT_DOSSIER_PATH = 'text-dossier';
export function textDossierLock(reference: Omit<CharacterLock, 'referencePath' | 'locked'> & Partial<CharacterLock>): CharacterLock {
  return { ...reference, referencePath: TEXT_DOSSIER_PATH, locked: true } as CharacterLock;
}
export function dossierWordCount(text: unknown): number { return typeof text === 'string' ? text.trim().split(/\s+/).filter(Boolean).length : 0; }

/** Cast members named anywhere in chapters 0..upToChapter (titles, summaries, section plans, written text).
 *  Writing a chapter only needs locked references for people who have debuted by then. */
export function castDueByChapter(cast: readonly string[], outline: { chapters?: unknown[] } | null | undefined, upToChapter: number): string[] {
  const chapters = Array.isArray(outline?.chapters) ? outline!.chapters.slice(0, Math.max(0, upToChapter) + 1) : [];
  const text = JSON.stringify(chapters);
  const lower = text.toLowerCase();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return cast.filter((name) => {
    const n = name?.trim(); if (!n) return false;
    if (lower.includes(n.toLowerCase())) return true;
    return n.split(/\s+/).filter((t) => t.length >= 3 && /^\p{Lu}/u.test(t)).some((t) => new RegExp(`\\b${esc(t)}\\b`, 'u').test(text));
  });
}
