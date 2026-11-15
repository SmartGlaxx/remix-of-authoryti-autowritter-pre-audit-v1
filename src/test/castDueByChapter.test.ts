import { describe, it, expect } from 'vitest';
import { castDueByChapter } from '../../supabase/functions/_shared/narrative/characterReference';
const outline = { chapters: [{ summary: 'Davon Marsh meets Shay at the bar.' }, { summary: 'Nothing.' }, { summary: 'Victor Teague arrives.' }] };
describe('castDueByChapter', () => {
  it('chapter 1 needs only people named by then', () => {
    expect(castDueByChapter(['Davon Marsh', 'Shay Okafor', 'Victor Teague'], outline, 0)).toEqual(['Davon Marsh', 'Shay Okafor']);
  });
  it('later chapter includes later debuts', () => {
    expect(castDueByChapter(['Victor Teague'], outline, 2)).toEqual(['Victor Teague']);
  });
});
