// Pure helpers for the author-facing conflict review: paired evidence, locations,
// recommendations, and safe targeted find/replace edits. No I/O.
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export const WORDS_PER_PAGE = 250;
const words = (s: string) => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];
const STOP = new Set("the a an and or of to in on at is was were be her his its their it this that with for as by from".split(" "));

export const paragraphs = (text: string) => String(text ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);

/** The paragraph sharing the most meaningful words with the query (exact substring wins). */
export function bestParagraph(text: string, query: string): { paragraph: string; index: number } | null {
  const ps = paragraphs(text);
  if (!ps.length || !query?.trim()) return null;
  const q = query.trim().replace(/\s+/g, " ").toLowerCase();
  const exact = ps.findIndex((p) => p.replace(/\s+/g, " ").toLowerCase().includes(q));
  if (exact >= 0) return { paragraph: ps[exact], index: exact };
  const qw = new Set(words(query).filter((w) => !STOP.has(w)));
  let best = -1, score = 0;
  ps.forEach((p, i) => { const s = new Set(words(p)); let n = 0; qw.forEach((w) => { if (s.has(w)) n++; }); if (n > score) { score = n; best = i; } });
  return best >= 0 && qw.size > 0 && score >= Math.max(2, Math.ceil(qw.size * 0.65)) ? { paragraph: ps[best], index: best } : null;
}

export interface Location { chapter: number; section: number; chapterTitle: string; sectionTitle: string; page: number | null; paragraphNumber: number | null }

/** Approximate page from words before the paragraph; null when the paragraph wasn't found. */
export function locate(outline: Row | null, chapter: number, section: number, paragraphIndex: number | null): Location {
  const chs: Row[] = Array.isArray(outline?.chapters) ? outline?.chapters : [];
  let before = 0;
  for (let c = 0; c < chs.length; c++) {
    const subs: Row[] = Array.isArray(chs[c]?.subsections) ? chs[c].subsections : [];
    for (let s = 0; s < subs.length; s++) {
      const ps = paragraphs(String(subs[s]?.content ?? ""));
      if (c === chapter && s === section) {
        if (paragraphIndex !== null) for (let i = 0; i < paragraphIndex && i < ps.length; i++) before += words(ps[i]).length;
        return { chapter, section, chapterTitle: String(chs[c]?.title ?? ""), sectionTitle: String(subs[s]?.title ?? ""),
          page: paragraphIndex === null ? null : Math.floor(before / WORDS_PER_PAGE) + 1, paragraphNumber: paragraphIndex === null ? null : paragraphIndex + 1 };
      }
      before += ps.reduce((n, p) => n + words(p).length, 0);
    }
  }
  return { chapter, section, chapterTitle: "", sectionTitle: "", page: null, paragraphNumber: null };
}

export type Recommendation = { choice: "prior" | "new" | "dismiss"; reason: string };

/** Recommend which side should stay true. Author-set details outrank generated prose; small wording changes are usually not real conflicts. */
export function recommend(o: { severity: string; authority?: string | null; priorSource: "author" | "accepted_text" | "unknown"; priorText: string; newText: string }): Recommendation {
  if (o.priorSource === "author" || /USER|AUTHOR|OUTLINE/i.test(String(o.authority ?? ""))) return { choice: "prior", reason: "You set this detail yourself, so it should stay the truth. Fix the new text to match." };
  const a = new Set(words(o.priorText).filter((w) => !STOP.has(w))), b = new Set(words(o.newText).filter((w) => !STOP.has(w)));
  let shared = 0; a.forEach((w) => { if (b.has(w)) shared++; });
  const overlap = a.size ? shared / a.size : 0;
  if (o.priorSource === "accepted_text" && overlap === 1 && a.size === b.size && o.severity !== "CRITICAL") return { choice: "dismiss", reason: "Both passages use the same detail. Consider dismissing this flag after reviewing the context." };
  return { choice: "prior", reason: "Earlier chapters already rely on the established detail. Keeping it avoids having to change other parts of the book." };
}

export type Edit = { find: string; replace: string };

/** Applies edits whose `find` occurs exactly once; rejects anything that would rewrite most of the text. */
export function applyTargetedEdits(text: string, edits: Edit[]): { text: string; applied: number } {
  let out = text, applied = 0;
  for (const e of (edits ?? []).slice(0, 4)) {
    if (typeof e?.find !== "string" || typeof e?.replace !== "string" || e.find.length < 3 || e.find === e.replace) continue;
    if (e.find.length > text.length * 0.5) continue;
    const first = out.indexOf(e.find);
    if (first < 0 || out.indexOf(e.find, first + 1) >= 0) continue;
    out = out.slice(0, first) + e.replace.replace(/[*#]/g, "") + out.slice(first + e.find.length);
    applied++;
  }
  return { text: out, applied };
}

export function parseEdits(raw: string): Edit[] {
  const m = String(raw ?? "").match(/\{[\s\S]*\}/);
  try { const j = JSON.parse(m ? m[0] : raw); return Array.isArray(j?.edits) ? j.edits : []; } catch { return []; }
}

export interface ChatMsg { role: "author" | "assistant"; content: string }

/** Editorial discussion about one conflict: the author explains intent; the assistant suggests and may propose targeted edits. */
export function discussionPrompt(o: { truth: string; conflicting: string; description: string; recommendation: string; history: ChatMsg[] }) {
  const turns = (o.history ?? []).slice(-12).map((m) => `${m.role === "author" ? "Author" : "Editor"}: ${m.content}`).join("\n");
  return {
    system: "You are a careful fiction continuity editor discussing one flagged contradiction with the author. Answer their question or opinion in 2-4 sentences, then optionally propose the smallest safe edits. No markdown. Reply only with JSON: {\"reply\":\"your answer to the author\",\"edits\":[{\"find\":\"exact text copied from the passage\",\"replace\":\"corrected text\"}]}. Include \"edits\" only when the author asked for a change or you can confidently suggest one; otherwise omit it or use an empty array. Never invent facts beyond the established detail.",
    user: `Established detail (this is true):\n${o.truth}\n\nProblem found:\n${o.description}\n\nRecommendation:\n${o.recommendation}\n\nPassage containing the conflict:\n${o.conflicting}\n\nConversation so far:\n${turns || "(none yet)"}`,
  };
}

export function parseDiscussion(raw: string): { reply: string; edits: Edit[] } {
  const m = String(raw ?? "").match(/\{[\s\S]*\}/);
  try {
    const j = JSON.parse(m ? m[0] : raw);
    return { reply: typeof j?.reply === "string" && j.reply.trim() ? j.reply.trim() : "I could not form a suggestion. Try rephrasing your thought.", edits: Array.isArray(j?.edits) ? j.edits : [] };
  } catch { return { reply: "I could not form a suggestion. Try rephrasing your thought.", edits: [] }; }
}

export function targetedRewritePrompt(o: { truth: string; conflicting: string; description: string }) {
  return {
    system: "You are a careful fiction continuity editor. Make the smallest possible change so the passage agrees with the established story detail. Keep voice, length and everything else unchanged. No markdown. Reply only with JSON: {\"edits\":[{\"find\":\"exact text copied from the passage\",\"replace\":\"corrected text\"}]} with at most 3 edits.",
    user: `Established detail (this is true):\n${o.truth}\n\nProblem found:\n${o.description}\n\nPassage containing the conflict:\n${o.conflicting}`,
  };
}