import { dossierWordCount } from './characterReference.ts';

/** Repair only the missing prose field; never replace the approved identity or designed features. */
export class CharacterProfileError extends Error {
  readonly code = 'CHARACTER_PROFILE_INCOMPLETE';
  readonly status = 422;
}

export async function ensureCharacterDossier(
  character: Record<string, unknown>,
  expand: (prompt: string) => Promise<string>,
): Promise<string> {
  const original = typeof character.dossier === 'string' ? character.dossier.trim() : '';
  if (dossierWordCount(original) >= 350) return original;
  const expanded = (await expand(`Expand ONLY the prose dossier for this already approved character to 500–700 words. Return plain prose only, no JSON, headings or markdown. The dossier field itself must contain the full 500–700 words, not words spread across other fields.
Preserve the name, identity, explicit story facts, designed measurements, appearance and behavioural tells below exactly. Do not rename an unidentified person or reveal a hidden identity. Do not invent a biography, relationships, discoveries or plot events; use the existing designed appearance, voice, posture and tells to supply detail. Unestablished story facts remain unknown. This is a reference profile, not manuscript prose.
APPROVED CARD: ${JSON.stringify(character)}`)).trim();
  if (dossierWordCount(expanded) < 350 || /^(?:```|\s*\{)/.test(expanded)) {
    throw new CharacterProfileError(`The profile for ${String(character.name ?? 'this character')} is incomplete after one expansion. Your saved profiles are unchanged; try preparing this character again.`);
  }
  return expanded;
}