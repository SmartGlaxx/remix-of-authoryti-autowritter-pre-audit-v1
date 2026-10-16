// Progressive Plan-to-Outline Bridge: turns the approved master plan + READY chapter/section
// plans into the writing desk's outline, so writing starts from the exploded summaries.
// Pure — no I/O. Written prose already in the old outline is kept at the same position.
type Row = Record<string, any>;

const clean = (s: unknown) => (typeof s === "string" ? s.trim() : "");
const firstSentence = (s: string, max = 70) => {
  const t = s.split(/(?<=[.!?])\s/)[0] ?? s;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

function latest(plans: Row[], level: string, ch: number, sub: number | null) {
  return plans
    .filter((p) => p.plan_level === level && p.chapter_index === ch && (sub === null ? p.subsection_index == null : p.subsection_index === sub)
      && (p.plan_status === "READY" || p.plan_status === "APPROVED"))
    .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
}

export function buildOutlineFromPlans(master: Row, plans: Row[], previous?: Row | null, characters?: Row[]) {
  const skeleton = (master?.plan_skeleton?.chapters ?? []) as Row[];
  const prevChapters = (previous?.chapters ?? []) as Row[];
  const chapters = skeleton.map((sk, ci) => {
    const chIdx = sk.chapterIndex ?? ci;
    const chPlan = latest(plans, "CHAPTER", chIdx, null)?.content ?? {};
    const prevCh = prevChapters[ci];
    const sections = ((chPlan.chapter?.sections ?? sk.sections ?? []) as Row[]).map((ss, si) => {
      const sIdx = ss.sectionIndex ?? si;
      const secPlan = latest(plans, "SECTION", chIdx, sIdx)?.content ?? {};
      const d = secPlan.detail ?? {};
      const entry = clean(d.entry), focus = clean(d.focus), outcome = clean(d.outcome);
      const objective = clean(ss.objective) || clean(secPlan.section?.objective);
      const summary = [entry, focus, outcome].filter(Boolean).join("\n\n") || objective;
      const prevSub = prevCh?.subsections?.[si];
      const content = clean(prevSub?.content) ? prevSub.content : undefined;
      return {
        id: `ch${ci + 1}-s${si + 1}`,
        title: clean(d.title) || clean(ss.title) || (focus || entry ? firstSentence(entry || focus) : `Section ${si + 1}`),
        summary,
        goal: outcome || objective || undefined,
        teaser: firstSentence(entry || summary, 160) || undefined,
        targetWords: ss.targetWords,
        ...(content ? { content, status: prevSub.status ?? "completed" } : { status: "pending" as const }),
      };
    });
    const done = sections.length > 0 && sections.every((s) => s.status === "completed");
    return {
      id: `ch-${ci + 1}`,
      chapterNumber: ci + 1,
      title: clean(chPlan.title) || clean(sk.title) || `Chapter ${ci + 1}`,
      summary: clean(sk.objective) || clean(chPlan.focus),
      subsections: sections,
      status: done ? "completed" : sections.some((s) => s.status === "completed") ? "writing" : "pending",
    };
  });
  return {
    ...(previous ?? {}),
    chapters,
    openPromises: previous?.openPromises ?? [],
    resolvedPromises: previous?.resolvedPromises ?? [],
    characters: characters?.length ? characters : previous?.characters ?? [],
    source: "progressive_plan",
    masterPlanId: master?.id,
  };
}
