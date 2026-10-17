import { describe, it, expect } from "vitest";
import {
  applyReplacements, findingKey, intentForKind, parseEvaluation, runPreAcceptance, type EvalContext, type EvalModel,
} from "../../supabase/functions/_shared/narrative/planning/evaluator";
import { assertAlternativesEligible, assertConceptsEligible, parseConcepts } from "../../supabase/functions/_shared/narrative/planning/aiPlanning";
import { blockingDiscrepancies } from "../../supabase/functions/_shared/narrative/planning/reconciliationFilter";
import { onlyEstablished } from "../../supabase/functions/_shared/narrative/supabaseRepo";

const ctx = (o: Partial<EvalContext> = {}): EvalContext => ({
  adapter: "fiction", isFiction: true, objective: "Mara finds the ledger.",
  beats: [{ id: "s1b1", kind: "discovery", intent: "immediate_payoff", required: true }, { id: "s1b2", kind: "clue setup", intent: "deferred_resolution", required: false }],
  anchors: [], facts: [{ id: "f1", text: "Mara has green eyes" }], secrets: [], ...o,
});
const reply = (o: unknown): EvalModel => async () => ({ text: JSON.stringify(o), usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.001 } });
const clean = { beats: [{ id: "s1b1", planted: true, resolved: true }, { id: "s1b2", planted: true, resolved: false }], continuity: [], claims: [], quality: [] };
const DRAFT = "Mara pulled the ledger from the drawer and read the first page twice.";

describe("Phase G runtime: combined evaluator", () => {
  it("accepts a clean draft with exactly one evaluator call", async () => {
    const r = await runPreAcceptance(DRAFT, ctx(), reply(clean), reply({ replacements: [] }));
    expect(r.decision).toBe("accept");
    expect(r.usage.calls).toBe(1);
  });

  it("a deferred mystery left unresolved is correct, not an omission", () => {
    expect(parseEvaluation(JSON.stringify(clean), ctx()).filter((f) => f.stage === 2)).toHaveLength(0);
  });

  it("explaining a deferred mystery early is a material finding", () => {
    const f = parseEvaluation(JSON.stringify({ ...clean, beats: [clean.beats[0], { id: "s1b2", planted: true, explanationRevealed: true }] }), ctx());
    expect(f.some((x) => x.code === "DEFERRAL_RESOLVED_EARLY" && x.severity === "material")).toBe(true);
  });

  it("a material canon contradiction blocks acceptance after at most 2 repair rounds", async () => {
    const bad = { ...clean, continuity: [{ kind: "fact", severity: "material", message: "Eyes are green in canon", excerpt: "her brown eyes", sourceRef: "f1" }] };
    const r = await runPreAcceptance(DRAFT, ctx(), reply(bad), reply({ replacements: [] }));
    expect(r.decision).toBe("blocked_material");
    expect(r.rounds).toBeLessThanOrEqual(2);
    expect(r.findings.find((f) => f.stage === 3)?.sourceRef).toBe("f1");
  });

  it("writing-quality notes never block acceptance", async () => {
    const q = { ...clean, quality: [{ severity: "moderate", message: "Pacing feels slow", excerpt: "read the first page" }] };
    const r = await runPreAcceptance(DRAFT, ctx(), reply(q), reply({ replacements: [] }));
    expect(r.decision).toBe("accept");
  });

  it("if the evaluator cannot run, the draft is held — never accepted unchecked", async () => {
    const r = await runPreAcceptance(DRAFT, ctx(), async () => { throw new Error("down"); }, reply({}));
    expect(r.decision).toBe("needs_author_review");
  });

  it("an author-approved canon change is no longer a violation, but other checks still apply", () => {
    const c = { kind: "fact", severity: "material", message: "Eyes changed", excerpt: "her brown eyes" };
    const key = findingKey({ code: "CANON_CONTRADICTION", excerpt: "her brown eyes" });
    const leak = { ...clean, beats: [clean.beats[0], { id: "s1b2", planted: true, explanationRevealed: true }], continuity: [c] };
    const f = parseEvaluation(JSON.stringify(leak), ctx({ approvedCanonKeys: [key] }));
    expect(f.find((x) => x.code === "CANON_CONTRADICTION")?.severity).toBe("info");
    expect(f.some((x) => x.code === "DEFERRAL_RESOLVED_EARLY" && x.severity === "material")).toBe(true);
  });

  it("a protected term alone is a note; a definite semantic disclosure blocks", async () => {
    const draft = "The butler was her father all along, she realised.";
    const noted = await runPreAcceptance(draft, ctx({ secrets: ["her father all along"] }), reply(clean), reply({ replacements: [] }));
    expect(noted.decision).toBe("accept");
    const leak = { ...clean, disclosures: [{ secret: 1, disclosed: true, certainty: "definite", excerpt: "The butler was her father all along" }] };
    const r = await runPreAcceptance(draft, ctx({ secrets: ["her father all along"] }), reply(leak), reply({ replacements: [] }));
    expect(r.decision).toBe("blocked_material");
  });

  it("auto-resolution conforms prose to canon and accepts without holding for the author", async () => {
    const bad = { ...clean, continuity: [{ kind: "fact", severity: "material", message: "Eyes are green in canon", excerpt: "read the first page twice", sourceRef: "f1" }] };
    let fixed = false;
    const evaluate: EvalModel = async () => ({ text: JSON.stringify(fixed ? clean : bad) });
    const repair: EvalModel = async () => { fixed = true; return { text: JSON.stringify({ replacements: [{ find: "read the first page twice", replace: "read the first page once" }] }) }; };
    const r = await runPreAcceptance(DRAFT, ctx(), evaluate, repair);
    expect(r.decision).toBe("accept");
    expect(r.autoResolved).toHaveLength(1);
    expect(r.autoResolved?.[0].code).toBe("CANON_CONTRADICTION");
    expect(r.text).toBe("Mara pulled the ledger from the drawer and read the first page once.");
  });

  it("auto-resolution that fails or regresses still holds the draft for the author", async () => {
    const bad = { ...clean, continuity: [{ kind: "fact", severity: "material", message: "Eyes are green in canon", excerpt: "read the first page twice", sourceRef: "f1" }] };
    // Repair changes text but the conflict persists on revalidation.
    const repair: EvalModel = async () => ({ text: JSON.stringify({ replacements: [{ find: "read the first page twice", replace: "read the first page once" }] }) });
    const r = await runPreAcceptance(DRAFT, ctx(), reply(bad), repair);
    expect(r.decision).toBe("blocked_material");
    expect(r.autoResolved).toBeUndefined();
  });

  it("targeted repair only replaces exact sentences from the draft", () => {
    const out = applyReplacements(DRAFT, JSON.stringify({ replacements: [{ find: "read the first page twice", replace: "read it once" }, { find: "not in the draft at all", replace: "x" }] }));
    expect(out).toBe("Mara pulled the ledger from the drawer and read it once.");
  });

  it("nonfiction claims marked documented without a source are material", () => {
    const f = parseEvaluation(JSON.stringify({ beats: [], claims: [{ id: "c1", tier: "documented", sourceProvided: false, excerpt: "In 1952 he moved" }] }), ctx({ adapter: "narrative_nonfiction", isFiction: false, beats: [] }));
    expect(f.some((x) => x.code === "UNSOURCED_DOCUMENTED" && x.stage === 4)).toBe(true);
  });

  it("maps beat kinds to intents", () => {
    expect(intentForKind("clue")).toBe("deferred_resolution");
    expect(intentForKind("setup")).toBe("setup_only");
  });
});

describe("Phase H: genre services and memory safety", () => {
  it("story alternatives and concepts work for every book type", () => {
    expect(() => assertAlternativesEligible("self-help", 3)).not.toThrow();
    expect(() => assertConceptsEligible("novel", 3)).not.toThrow();
    expect(() => assertConceptsEligible("self-help", 4)).toThrow();
    expect(() => assertConceptsEligible("self-help", 5)).not.toThrow();
  });

  it("rejects nonfiction concepts that use a plot-twist structure", () => {
    const mk = (t: string, extra = "") => ({ title: t, coreThesis: `Thesis about ${t} ${extra}`, approach: `Approach ${t} uses steps`, pillars: ["a", "b"], readerOutcome: "x", summary: "s" });
    const r = parseConcepts(JSON.stringify({ concepts: [mk("One"), mk("Two", "with a plot twist"), mk("Three")] }), 3);
    expect(r.ok).toBe(false);
  });

  it("uncertain or superseded memory is excluded from writing context", () => {
    const rows = [{ id: 1, canon_status: "ESTABLISHED" }, { id: 2, canon_status: "UNCERTAIN" }, { id: 3, canon_status: "SUPERSEDED" }, { id: 4 }];
    expect(onlyEstablished(rows).map((r) => r.id)).toEqual([1, 4]);
  });

  it("contradictions from a discarded draft no longer block later sections", () => {
    const logs = [
      { decision: "PENDING", dedup_key: "a", severity: "CRITICAL", application_status: "ABANDONED" },
      { decision: "PENDING", dedup_key: "b", severity: "CRITICAL", application_status: "NOT_APPLICABLE" },
    ];
    expect(blockingDiscrepancies(logs).map((l) => l.dedup_key)).toEqual(["b"]);
  });
});
