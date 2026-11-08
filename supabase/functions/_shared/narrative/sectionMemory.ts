// Accepted prose only. No invented summaries, quote normalization or future sections.
export interface DialogueIncident {
  id: string; label: string; location: string | null; time: string | null; source: string;
  participants: string[]; addressedTo: string[]; present: string[];
  turns: { n: number; speaker: string; text: string; delivery: string | null }[];
  groups?: Record<string, string[]>;
}
export interface SectionMemory {
  summary: { writerView: string[]; characterViews: Record<string, string[]> };
  dialogueCards: { incidents: Record<string, DialogueIncident>; people: Record<string, { incidentIds: string[] }> };
  sectionTime: { date: string | null; time: string | null };
}
export function paragraphsOf(text: string): string[] {
  return text.replace(/<br\s*\/?>(\s*<br\s*\/?>)+/gi, '\n\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
}
const sentence = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0
  && new Intl.Segmenter('en', { granularity: 'sentence' }).segment(s.trim())
    && [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(s.trim())].length === 1;
const names = (v: unknown): string[] => {
  if (!Array.isArray(v) || v.some(n => typeof n !== 'string' || !n.trim())) throw new Error('Invalid incident participants');
  return [...new Set(v as string[])];
};
export function parseSectionMemory(raw: unknown, text: string, source: string): SectionMemory {
  if (!raw || typeof raw !== 'object') throw new Error('Paragraph memory is missing');
  const r = raw as SectionMemory;
  const count = paragraphsOf(text).length;
  const validView = (v: unknown) => Array.isArray(v) && v.length === count && v.every(sentence);
  if (!validView(r.summary?.writerView)) throw new Error('Each paragraph needs exactly one writer-view sentence');
  if (!r.summary.characterViews || Array.isArray(r.summary.characterViews) || typeof r.summary.characterViews !== 'object') throw new Error('Character views are missing');
  for (const v of Object.values(r.summary.characterViews)) if (!validView(v)) throw new Error('Each paragraph needs exactly one sentence per character view');
  if (!r.dialogueCards?.incidents || typeof r.dialogueCards.incidents !== 'object' || Array.isArray(r.dialogueCards.incidents)) throw new Error('Dialogue incidents are missing');
  const incidents: Record<string, DialogueIncident> = {};
  const people: SectionMemory['dialogueCards']['people'] = {};
  const used = new Set<number>();
  for (const [id, incident] of Object.entries(r.dialogueCards.incidents)) {
    const participants = names(incident.participants), addressedTo = names(incident.addressedTo), present = names(incident.present);
    if (!id || incident.id !== id || !Array.isArray(incident.turns)) throw new Error('Invalid dialogue incident');
    const groups: Record<string, string[]> = {};
    for (const [group, members] of Object.entries(incident.groups ?? {})) groups[group] = names(members);
    let cursor = 0;
    const speakers = new Set([...participants, ...Object.keys(groups)]);
    const turns = incident.turns.map((turn, i) => {
      if (turn.n !== i + 1 || typeof turn.text !== 'string' || !turn.text || !speakers.has(turn.speaker)) throw new Error('Invalid speaker or turn order');
      let at = text.indexOf(turn.text, cursor);
      while (at >= 0 && used.has(at)) at = text.indexOf(turn.text, at + 1);
      if (at < 0) throw new Error('Dialogue must be verbatim and ordered in the accepted prose');
      used.add(at); cursor = at + turn.text.length;
      return { ...turn, delivery: turn.delivery ?? null };
    });
    incidents[id] = { ...incident, source, participants, addressedTo, present, turns, groups };
    for (const person of new Set([...participants, ...addressedTo, ...present, ...Object.values(groups).flat(), ...turns.map(t => t.speaker)])) {
      people[person] ??= { incidentIds: [] }; people[person].incidentIds.push(id);
    }
  }
  return { summary: r.summary, dialogueCards: { incidents, people }, sectionTime: { date: r.sectionTime?.date ?? null, time: r.sectionTime?.time ?? null } };
}
export function memoryExtractionInstruction(text: string): string {
  return `ALSO return "section_memory": {"summary":{"writerView":[],"characterViews":{}},"dialogueCards":{"incidents":{},"people":{}},"sectionTime":{"date":null,"time":null}}.
There are ${paragraphsOf(text).length} paragraphs. For EVERY paragraph give exactly ONE sentence in writerView and exactly ONE sentence in each present character's characterViews array, in paragraph order. If absent/unaware, say so; never give a character the writer's hidden knowledge. Writer view summarizes only what this accepted text establishes, not future plans.
Dialogue incidents: {id,label,location,time,source,participants:[],addressedTo:[],present:[],groups:{groupName:[members]},turns:[{n:1,speaker,text,delivery:null}]}. Copy spoken text CHARACTER-FOR-CHARACTER, punctuation included; no paraphrase, truncation or skipped spoken exchanges. Distinguish quoted labels/thoughts from speech. Speakers must be participants or named groups. Use full known names. Group members and witnesses belong in the incident; unknown speakers must not be guessed. Delivery is separate from spoken text. No separate location ledger. Extract section date/time only if established, otherwise null (never invent a historical date).`;
}
export interface MemoryRow { chapter_index: number; subsection_index: number; content_hash: string; status: string; applied: { sectionMemory?: SectionMemory } }
export interface MemoryChapter { subsections: { content?: string; status?: string }[] }
export function acceptedMemoryEntries(rows: MemoryRow[], chapters: MemoryChapter[], before: { chapterIndex: number; subsectionIndex: number }, hash: (text: string) => string) {
  return rows.filter(r => {
    const sub = chapters[r.chapter_index]?.subsections?.[r.subsection_index];
    return r.status === 'completed' && !!r.applied?.sectionMemory && sub?.status === 'completed' && !!sub.content
      && hash(sub.content) === r.content_hash
      && (r.chapter_index < before.chapterIndex || r.chapter_index === before.chapterIndex && r.subsection_index < before.subsectionIndex);
  }).sort((a,b) => a.chapter_index - b.chapter_index || a.subsection_index - b.subsection_index);
}
export function renderWholeBookMemory(rows: MemoryRow[], chapters: MemoryChapter[], before: { chapterIndex: number; subsectionIndex: number }, hash: (text: string) => string): string {
  const entries = acceptedMemoryEntries(rows, chapters, before, hash);
  if (!entries.length) return '';
  const all = entries.map(r => `Chapter ${r.chapter_index + 1}, section ${r.subsection_index + 1}:\n${JSON.stringify(r.applied.sectionMemory)}`).join('\n');
  const recent = entries.filter(r => r.chapter_index >= Math.max(0, before.chapterIndex - 3))
    .map(r => `Chapter ${r.chapter_index + 1}, section ${r.subsection_index + 1}:\n${chapters[r.chapter_index].subsections[r.subsection_index].content}`).join('\n\n');
  return `ACCEPTED WHOLE-BOOK MEMORY (past only; character views are knowledge-limited; dialogue is testimony, not automatically truth):\n${all}\n\nRECENT ACCEPTED CHAPTERS — FULL TEXT (continue, never reintroduce or repeat):\n${recent}`;
}
export function timeReferenceAssessment(relative: number, exactQualifiers: number) {
  return { countOK: relative >= 4 && relative <= 8, qualifierRatioOK: relative > 0 && exactQualifiers / relative >= .6 && exactQualifiers / relative <= .7 };
}