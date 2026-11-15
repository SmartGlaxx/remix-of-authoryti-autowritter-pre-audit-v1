import { describe, expect, it, vi } from 'vitest';
import { CharacterProfileError, ensureCharacterDossier } from '../../supabase/functions/_shared/narrative/characterDossier';

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
describe('Character dossier recovery', () => {
  it('keeps a complete 500-word dossier without another AI call', async () => {
    const expand = vi.fn();
    expect(await ensureCharacterDossier({ name: 'Roy Castellan', dossier: words(500) }, expand)).toBe(words(500));
    expect(expand).not.toHaveBeenCalled();
  });
  it('preserves the existing 350-word acceptance boundary', async () => {
    const expand = vi.fn();
    expect(await ensureCharacterDossier({ dossier: words(350) }, expand)).toBe(words(350));
    expect(expand).not.toHaveBeenCalled();
  });
  it('expands the reported unidentified person once without changing their card', async () => {
    const card = { id: 'cast-id', name: 'Unidentified person in sedan', dossier: words(100), reference: { heightCm: 180, tells: ['taps steering wheel'] } };
    const before = structuredClone(card);
    const expand = vi.fn().mockResolvedValue(words(550));
    expect(await ensureCharacterDossier(card, expand)).toBe(words(550));
    expect(expand).toHaveBeenCalledTimes(1);
    expect(expand.mock.calls[0][0]).toContain(JSON.stringify(card));
    expect(card).toEqual(before);
  });
  it('recovers a missing or non-string dossier', async () => {
    for (const dossier of [undefined, null, { text: 'wrong shape' }]) {
      const expand = vi.fn().mockResolvedValue(words(500));
      expect(await ensureCharacterDossier({ name: 'Roy', dossier }, expand)).toBe(words(500));
      expect(expand).toHaveBeenCalledTimes(1);
    }
  });
  it('fails with a controlled 422 rather than locking a short profile or retrying forever', async () => {
    const expand = vi.fn().mockResolvedValue(words(349));
    await expect(ensureCharacterDossier({ name: 'Unidentified person in sedan', dossier: words(20) }, expand)).rejects.toMatchObject({ code: 'CHARACTER_PROFILE_INCOMPLETE', status: 422 });
    expect(expand).toHaveBeenCalledTimes(1);
  });
  it('does not accept JSON or fenced output as a prose dossier', async () => {
    for (const output of [`{"dossier":"${words(500)}"}`, `\`\`\`text\n${words(500)}\n\`\`\``]) {
      await expect(ensureCharacterDossier({}, async () => output)).rejects.toBeInstanceOf(CharacterProfileError);
    }
  });
  it('propagates provider failures without further expansion calls', async () => {
    const failure = new Error('insufficient credits');
    const expand = vi.fn().mockRejectedValue(failure);
    await expect(ensureCharacterDossier({}, expand)).rejects.toBe(failure);
    expect(expand).toHaveBeenCalledTimes(1);
  });
});