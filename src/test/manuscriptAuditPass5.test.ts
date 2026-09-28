import { describe, it, expect } from "vitest";
import {
  AUDIT_STAGES, buildAuditPrompt, buildEvidenceIndex, buildManuscriptSections, canonicalFactFindings, classifyPlotThread, computeAuditInputs,
  continuityHistoryFindings, dedupKey, deduplicateFindings, emptyRelated, initialStageProgress, isStyleOrPacing, parseStageOutput,
  plotThreadFindings, redundancyFindings, renderManuscriptDigest, serializeNarrativeState, structuralGapFindings, summarizeFindings,
  toFindingRow, validateFinding, verifyExcerptInManuscript, type RawFinding, type ValidatedFinding,
} from "../../supabase/functions/_shared/narrative/audit";
import type { NarrativeRows } from "../../supabase/functions/_shared/narrative/context";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rows = (p: Partial<NarrativeRows> = {}): NarrativeRows => ({ characters: [], states: [], events: [], participants: [], threads: [], threadEvents: [], facts: [], timeline: [], entities: [], snapshots: [], ...p });
const outline = (chapters: string[][]) => ({ chapters: chapters.map((subs, i) => ({ title: `C${i + 1}`, subsections: subs.map((c, j) => ({ title: `S${j + 1}`, content: c, status: c ? "completed" : "pending" })) })) });
const raw = (p: Partial<RawFinding> = {}): RawFinding => ({ category: "timeline", severity: "MEDIUM", confidence: 0.8, title: "Issue", description: "d", evidenceExcerpt: null, contradictingExcerpt: null, contradictingEvidence: null, related: emptyRelated(), explanation: "", suggestedAction: "", ...p });

const fiction = outline([["Mara locked the brass key in the drawer before dawn.", "She walked to the harbour at noon."], ["At night Mara opened the drawer and found the brass key gone."]]);
const secs = buildManuscriptSections(fiction);

describe("Pass 5 — stages & inputs", () => {
  it("1. has the 12 named stages", () => { expect(AUDIT_STAGES).toHaveLength(12); expect(AUDIT_STAGES).toContain("evidence_validation"); });
  it("2. fiction skips nonfiction_consistency", () => { expect(initialStageProgress("novel").nonfiction_consistency.status).toBe("skipped"); });
  it("3. nonfiction runs nonfiction_consistency and skips character stages", () => {
    const p = initialStageProgress("self_help"); expect(p.nonfiction_consistency.status).toBe("pending"); expect(p.character_arcs.status).toBe("skipped");
  });
  it("4. unchanged inputs reuse the cache key", async () => {
    const a = await computeAuditInputs({ manuscript: "x", outline: fiction, rows: rows() });
    const b = await computeAuditInputs({ manuscript: "x", outline: fiction, rows: rows() });
    expect(a.cache_key).toBe(b.cache_key);
  });
  it("5. changed manuscript misses the cache", async () => {
    const a = await computeAuditInputs({ manuscript: "x", outline: fiction, rows: rows() });
    const b = await computeAuditInputs({ manuscript: "y", outline: fiction, rows: rows() });
    expect(a.cache_key).not.toBe(b.cache_key);
  });
  it("6. same manuscript + changed narrative memory misses the cache", async () => {
    const a = await computeAuditInputs({ manuscript: "x", outline: fiction, rows: rows() });
    const b = await computeAuditInputs({ manuscript: "x", outline: fiction, rows: rows({ facts: [{ id: U(1), value: "v" }] }) });
    expect(a.narrative_state_version).not.toBe(b.narrative_state_version); expect(a.cache_key).not.toBe(b.cache_key);
  });
  it("7. narrative version ignores timestamps and row order", () => {
    const f1 = { id: U(1), value: "a", updated_at: "1" }, f2 = { id: U(2), value: "b", created_at: "2" };
    expect(serializeNarrativeState(rows({ facts: [f1, f2] }))).toBe(serializeNarrativeState(rows({ facts: [{ ...f2, created_at: "9" }, { ...f1, updated_at: "8" }] })));
  });
  it("8. outline change (not prose) misses the cache", async () => {
    const a = await computeAuditInputs({ manuscript: "x", outline: fiction, rows: rows() });
    const b = await computeAuditInputs({ manuscript: "x", outline: { ...fiction, chapters: [...fiction.chapters, { title: "New", subsections: [] }] }, rows: rows() });
    expect(a.outline_hash).not.toBe(b.outline_hash);
  });
  it("9. large manuscripts are staged within budget", () => {
    const big = buildManuscriptSections(outline([Array.from({ length: 50 }, (_, i) => `Start${i} ` + "word ".repeat(4000) + `End${i}`)]));
    const d = renderManuscriptDigest(big, 60_000);
    expect(d.length).toBeLessThan(80_000); expect(d).toContain("Start49"); expect(d).toContain("End49"); expect(d).toContain("condensed");
  });
});

describe("Pass 5 — evidence validation", () => {
  const idx = buildEvidenceIndex(rows({ facts: [{ id: U(1), authority: "USER_CANON", is_canonical: true }, { id: U(2), authority: "AI_INFERENCE", is_canonical: true }], threads: [{ id: U(3) }] }), [{ id: U(4) }]);
  it("10. finds the location of a real excerpt", () => { expect(verifyExcerptInManuscript("found the brass key gone", secs)).toEqual({ chapterIndex: 1, subsectionIndex: 0 }); });
  it("11. rejects a hallucinated excerpt", () => { expect(validateFinding(raw({ evidenceExcerpt: "Mara flew to the moon on a dragon" }), secs, idx)).toEqual({ ok: false, reason: "fabricated_excerpt" }); });
  it("12. rejects findings with no evidence", () => { expect(validateFinding(raw(), secs, idx)).toEqual({ ok: false, reason: "no_evidence" }); });
  it("13. rejects findings citing only nonexistent DB ids", () => { expect(validateFinding(raw({ related: { ...emptyRelated(), facts: [U(99)] } }), secs, idx)).toEqual({ ok: false, reason: "fabricated_ids" }); });
  it("14. partial fake ids → UNCERTAIN with fakes removed", () => {
    const v = validateFinding(raw({ related: { ...emptyRelated(), threads: [U(3), U(98)] } }), secs, idx);
    expect(v.ok && v.finding.verification).toBe("UNCERTAIN"); expect(v.ok && v.finding.related.threads).toEqual([U(3)]);
  });
  it("15. valid DB-only evidence is accepted", () => { expect(validateFinding(raw({ related: { ...emptyRelated(), checks: [U(4)] } }), secs, idx).ok).toBe(true); });
  it("16. unverifiable contradicting excerpt → UNCERTAIN", () => {
    const v = validateFinding(raw({ evidenceExcerpt: "locked the brass key in the drawer", contradictingExcerpt: "invented contradicting quote here" }), secs, idx);
    expect(v.ok && v.finding.verification).toBe("UNCERTAIN"); expect(v.ok && v.finding.contradictingExcerpt).toBeNull();
  });
  it("17. USER_CANON is protected but severity is not inflated", () => {
    const v = validateFinding(raw({ severity: "MEDIUM", related: { ...emptyRelated(), facts: [U(1)] } }), secs, idx);
    expect(v.ok && v.finding.userCanonProtected).toBe(true); expect(v.ok && v.finding.severity).toBe("MEDIUM");
  });
  it("18. AI_INFERENCE facts are not USER_CANON protected", () => {
    const v = validateFinding(raw({ related: { ...emptyRelated(), facts: [U(2)] } }), secs, idx); expect(v.ok && v.finding.userCanonProtected).toBe(false);
  });
  it("19. style/pacing findings are rejected", () => {
    expect(isStyleOrPacing(raw({ title: "Pacing drags in chapter 2" }))).toBe(true);
    expect(validateFinding(raw({ title: "Writing style is flat", evidenceExcerpt: "walked to the harbour at noon" }), secs, idx)).toEqual({ ok: false, reason: "style_or_pacing" });
  });
});

describe("Pass 5 — deterministic stages", () => {
  it("20. OPEN_INTENTIONAL vs OPEN_UNRESOLVED", () => {
    expect(classifyPlotThread({ status: "OPEN", description: "left open for the sequel" }, { bookComplete: true })).toBe("OPEN_INTENTIONAL");
    expect(classifyPlotThread({ status: "OPEN", description: "who stole the key" }, { bookComplete: true })).toBe("OPEN_UNRESOLVED");
  });
  it("21. unfinished book → UNCERTAIN, not unresolved", () => { expect(classifyPlotThread({ status: "DEVELOPING" }, { bookComplete: false })).toBe("UNCERTAIN"); });
  it("22. resolved/superseded threads produce no findings", () => {
    expect(plotThreadFindings(rows({ threads: [{ id: U(1), status: "RESOLVED" }, { id: U(2), status: "OPEN", superseded_by: U(1) }] }), true)).toHaveLength(0);
  });
  it("23. unresolved major thread → HIGH", () => {
    const f = plotThreadFindings(rows({ threads: [{ id: U(1), status: "OPEN", importance: "major", title: "Key thief" }] }), true);
    expect(f[0].severity).toBe("HIGH"); expect(f[0].related.threads).toEqual([U(1)]);
  });
  it("24. disputed fact vs USER_CANON surfaces; severity from impact", () => {
    const r = rows({ facts: [
      { id: U(1), authority: "USER_CANON", is_canonical: true, category: "character", subject: "Evelyn", predicate: "vow", value: "silent" },
      { id: U(2), authority: "AI_INFERENCE", is_canonical: false, conflict_status: "disputed", conflicting_fact_id: U(1), value: "screams", confidence: 0.9 },
    ] });
    const f = canonicalFactFindings(r); expect(f).toHaveLength(1); expect(f[0].severity).toBe("MEDIUM");
  });
  it("25. disputed vs AI_INFERENCE canon is not authoritative", () => {
    expect(canonicalFactFindings(rows({ facts: [{ id: U(1), authority: "AI_INFERENCE", is_canonical: true }, { id: U(2), conflict_status: "disputed", conflicting_fact_id: U(1) }] }))).toHaveLength(0);
  });
  it("26. Pass 4 NEEDS_REVIEW history surfaced; latest check wins", () => {
    const checks = [
      { id: U(1), chapter_index: 0, subsection_index: 0, status: "NEEDS_REVIEW", max_severity: "HIGH", issues: [1], created_at: "2026-01-01" },
      { id: U(2), chapter_index: 0, subsection_index: 1, status: "NEEDS_REVIEW", max_severity: "HIGH", issues: [1], created_at: "2026-01-01" },
      { id: U(3), chapter_index: 0, subsection_index: 1, status: "PASSED", issues: [], created_at: "2026-01-02" },
    ];
    const f = continuityHistoryFindings(checks, secs); expect(f).toHaveLength(1); expect(f[0].related.checks).toEqual([U(1)]);
  });
  it("27. redundancy detects verbatim repetition across sections", () => {
    const s = "The old lighthouse keeper watched the grey sea swallow the last of the fading evening light.";
    const f = redundancyFindings(buildManuscriptSections(outline([[s, "Other text."], [s]])));
    expect(f).toHaveLength(1); expect(f[0].severity).toBe("LOW");
  });
  it("28. empty section before written ones is a structural gap", () => {
    const f = structuralGapFindings(buildManuscriptSections(outline([["a b c", ""], ["d e f"]])));
    expect(f).toHaveLength(1); expect(f[0].evidenceLocation).toEqual({ chapterIndex: 0, subsectionIndex: 1 });
  });
  it("29. clean fiction/nonfiction produce zero deterministic findings", () => {
    expect([...plotThreadFindings(rows(), true), ...canonicalFactFindings(rows()), ...redundancyFindings(secs), ...structuralGapFindings(secs)]).toHaveLength(0);
    const nf = buildManuscriptSections(outline([["Habits compound at 1% a day."], ["Track one habit for 30 days."]]));
    expect([...redundancyFindings(nf), ...structuralGapFindings(nf)]).toHaveLength(0);
  });
});

describe("Pass 5 — parsing, dedup, persistence", () => {
  it("30. parses model output and throws on junk (never 'clean')", () => {
    expect(parseStageOutput('```json\n{"findings":[{"title":"T","severity":"HIGH","confidence":2}]}\n```', "timeline")[0]).toMatchObject({ severity: "HIGH", confidence: 1 });
    expect(() => parseStageOutput("no json", "timeline")).toThrow();
  });
  it("31. dedup keeps highest severity and merges ids; stable key", () => {
    const base = { ...raw({ evidenceExcerpt: "found the brass key gone" }), verification: "VERIFIED" as const, evidenceLocation: null, contradictingLocation: null, userCanonProtected: false };
    const a: ValidatedFinding = { ...base, severity: "LOW", dedupKey: dedupKey(base) };
    const b: ValidatedFinding = { ...base, severity: "HIGH", dedupKey: dedupKey(base) };
    const out = deduplicateFindings([a, b]); expect(out).toHaveLength(1); expect(out[0].severity).toBe("HIGH");
    expect(dedupKey(base)).toBe(dedupKey({ ...base }));
  });
  it("32. rows are never auto-fixable and start OPEN", () => {
    const v = validateFinding(raw({ evidenceExcerpt: "walked to the harbour at noon" }), secs, buildEvidenceIndex(rows()));
    const r = toFindingRow((v as { finding: ValidatedFinding }).finding, { auditId: U(1), bookId: U(2), userId: U(3) });
    expect(r.auto_fixable).toBe(false); expect(r.status).toBe("OPEN"); expect(r.evidence_location).toEqual({ chapterIndex: 0, subsectionIndex: 1 });
  });
  it("33. prompt forbids style, rewriting and invented ids; summary counts", () => {
    const p = buildAuditPrompt("nonfiction_consistency", { digest: "d", stateText: "", outlineText: "", nonfiction: true, idCatalog: "" });
    expect(p.system).toMatch(/never rewrite/i); expect(p.system).toMatch(/Never invent/); expect(p.system).toMatch(/Do NOT fact-check/);
    expect(summarizeFindings([], { fabricated_excerpt: 2 })).toMatchObject({ total: 0, rejected: { fabricated_excerpt: 2 } });
  });
});

describe("Pass 5 — cross-stage dedup", () => {
  it("34. same passage flagged by several stages collapses to one", () => {
    const idx = buildEvidenceIndex(rows());
    const a = validateFinding(raw({ category: "character_arc", title: "Blind but sees", evidenceExcerpt: "Mara locked the brass key", severity: "HIGH" }), secs, idx);
    const b = validateFinding(raw({ category: "timeline", title: "Other wording", evidenceExcerpt: "Mara locked the brass key in the drawer", severity: "CRITICAL" }), secs, idx);
    const c = validateFinding(raw({ category: "timeline", title: "Different passage", evidenceExcerpt: "walked to the harbour at noon" }), secs, idx);
    const out = deduplicateFindings([a, b, c].map((v) => (v as { finding: ValidatedFinding }).finding));
    expect(out).toHaveLength(2); expect(out[0].severity).toBe("CRITICAL");
  });
});
