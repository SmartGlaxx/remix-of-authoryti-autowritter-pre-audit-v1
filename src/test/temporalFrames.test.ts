import { describe, expect, it } from 'vitest';
import {
  parseRawTimeOfDay, parseRelativeShift, validateTemporalFrames, timeMixAssessment, mixOf,
  type ParagraphTimeAnchor,
} from '../../supabase/functions/_shared/narrative/temporalFrames';

const anchor = (i: number, over: Partial<ParagraphTimeAnchor> = {}): ParagraphTimeAnchor => ({
  paragraphIndex: i, frameType: 'linear', frameId: 'main', relativeTime: null, rawTime: null, parentReturnIndex: null, ...over,
});

describe('Raw vs relative time parsing', () => {
  it('resolves raw clock and calendar stamps', () => {
    expect(parseRawTimeOfDay('7:00 PM')).toBe(1140);
    expect(parseRawTimeOfDay('at noon')).toBe(720);
    expect(parseRawTimeOfDay('midnight')).toBe(0);
    expect(parseRawTimeOfDay('6:30 am')).toBe(390);
  });
  it('never guesses a clock from vague phrases', () => {
    expect(parseRawTimeOfDay('later that evening')).toBeNull();
    expect(parseRawTimeOfDay('29th June')).toBeNull(); // date without clock time
  });
  it('resolves explicit relative durations', () => {
    expect(parseRelativeShift('five hours later')?.minutes).toBe(300);
    expect(parseRelativeShift('Twenty minutes later')?.minutes).toBe(20);
    expect(parseRelativeShift('3 days later')?.minutes).toBe(4320);
    expect(parseRelativeShift('half an hour later')?.minutes).toBe(30);
  });
  it('treats day advances and vague markers as markers, not guesses', () => {
    expect(parseRelativeShift('the next morning')).toMatchObject({ dayAdvance: true, markerOnly: true });
    expect(parseRelativeShift('a few hours later')?.markerOnly).toBe(true);
    expect(parseRelativeShift('later that day')?.markerOnly).toBe(true);
  });
});

describe('Temporal frame validation', () => {
  it('catches the noon + five hours = 7 PM contradiction', () => {
    const findings = validateTemporalFrames([
      anchor(0, { rawTime: 'noon' }),
      anchor(1, { relativeTime: 'five hours later', rawTime: '7:00 PM' }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('clock_contradiction');
  });
  it('accepts consistent relative-plus-raw paragraphs', () => {
    expect(validateTemporalFrames([
      anchor(0, { rawTime: '12:00 PM' }),
      anchor(1, { relativeTime: 'five hours later', rawTime: '5:00 PM' }),
    ])).toEqual([]);
  });
  it('allows relative advances to roll across midnight', () => {
    expect(validateTemporalFrames([
      anchor(0, { rawTime: '8:00 PM' }),
      anchor(1, { relativeTime: 'five hours later', rawTime: '1:00 AM' }),
    ])).toEqual([]);
  });
  it('flags a raw time that moves the linear clock backwards without a marker', () => {
    const findings = validateTemporalFrames([
      anchor(0, { rawTime: '8:00 PM' }),
      anchor(1, { rawTime: '12:00 PM' }),
    ]);
    expect(findings.map(f => f.kind)).toEqual(['unanchored_jump']);
  });
  it('accepts an anchored day advance to an earlier clock time', () => {
    expect(validateTemporalFrames([
      anchor(0, { rawTime: '8:00 PM' }),
      anchor(1, { relativeTime: 'the next morning', rawTime: '7:00 AM' }),
    ])).toEqual([]);
  });
  it('never flags a properly tagged flashback as a reverse-clock error', () => {
    const findings = validateTemporalFrames([
      anchor(0, { rawTime: '5:00 PM' }),
      anchor(1, { frameType: 'flashback', frameId: 'cairo', relativeTime: 'three months back', rawTime: '6:00 AM', parentReturnIndex: 2 }),
      anchor(2, { rawTime: '5:20 PM' }),
    ]);
    expect(findings).toEqual([]);
  });
  it('checks arithmetic inside a flashback frame independently', () => {
    const findings = validateTemporalFrames([
      anchor(0, { rawTime: '5:00 PM' }),
      anchor(1, { frameType: 'memory', frameId: 'prague', rawTime: '9:00 AM' }),
      anchor(2, { frameType: 'memory', frameId: 'prague', relativeTime: 'two hours later', rawTime: '2:00 PM' }),
      anchor(3, { rawTime: '5:05 PM' }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ paragraphIndex: 2, kind: 'clock_contradiction' });
  });
  it('flags a non-linear frame that opens with no anchor at all', () => {
    const findings = validateTemporalFrames([
      anchor(0, { rawTime: '5:00 PM' }),
      anchor(1, { frameType: 'parallel', frameId: 'across-town' }),
    ]);
    expect(findings.map(f => f.kind)).toEqual(['unanchored_frame']);
  });
  it('flags a main-clock resume that goes backwards after a memory', () => {
    const findings = validateTemporalFrames([
      anchor(0, { rawTime: '5:00 PM' }),
      anchor(1, { frameType: 'memory', frameId: 'reverie', relativeTime: 'three years earlier', rawTime: 'dawn', parentReturnIndex: 2 }),
      anchor(2, { rawTime: '4:30 PM' }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('reverse_clock');
  });
  it('tolerates approximate prose durations within 45 minutes', () => {
    expect(validateTemporalFrames([
      anchor(0, { rawTime: 'noon' }),
      anchor(1, { relativeTime: 'about an hour later', rawTime: '12:50 PM' }),
    ])).toEqual([]);
  });
});

describe('Chapter time mix', () => {
  it('requires 4–8 temporal references per chapter', () => {
    expect(timeMixAssessment({ relativeOnly: 2, rawOnly: 1, combined: 1 }).totalOK).toBe(true);
    expect(timeMixAssessment({ relativeOnly: 2, rawOnly: 0, combined: 1 }).totalOK).toBe(false);
    expect(timeMixAssessment({ relativeOnly: 5, rawOnly: 2, combined: 2 }).totalOK).toBe(false);
  });
  it('scores the mix proportionally, not against a literal ten', () => {
    // 12 total: 6 relative (50%), 2 raw (~17%), 4 combined (~33%) — all inside the bands.
    const ok = timeMixAssessment({ relativeOnly: 6, rawOnly: 2, combined: 4 });
    expect(ok).toMatchObject({ totalOK: false, relativeShareOK: true, rawShareOK: true, combinedShareOK: true });
    // 20 total: same per-10 proportions (10/3/6) also pass the share checks.
    const ok20 = timeMixAssessment({ relativeOnly: 10, rawOnly: 3, combined: 6 });
    expect([ok20.relativeShareOK, ok20.rawShareOK, ok20.combinedShareOK]).toEqual([true, true, true]);
  });
  it('rejects mixes outside the 40–60 / 10–30 / 20–40 bands', () => {
    const skewed = timeMixAssessment({ relativeOnly: 8, rawOnly: 0, combined: 1 });
    expect([skewed.relativeShareOK, skewed.rawShareOK, skewed.combinedShareOK]).toEqual([false, false, false]);
  });
  it('classifies anchors into alone vs combined buckets', () => {
    expect(mixOf([
      anchor(0, { relativeTime: 'five hours later' }),
      anchor(1, { rawTime: '7:00 PM' }),
      anchor(2, { relativeTime: 'the next morning', rawTime: '6:00 AM' }),
      anchor(3),
    ])).toEqual({ relativeOnly: 1, rawOnly: 1, combined: 1 });
  });
});
