// Phase G runtime — pre-acceptance AI evaluation (pure). One structured evaluator call covers
// plan fulfillment, continuity/canon, epistemic integrity and writing quality, while every
// finding keeps its own stage, severity and source reference. Stage 1 (free deterministic)
// always runs too. Subjective style never blocks acceptance; critical checks are never skipped:
// if the evaluator cannot run, the draft is held for the author instead of accepted unchecked.
import {
  checkEvidence, classifyBeats, deterministicValidation, routeFinding, runValidationLoop,
  type Adapter, type BeatCheck, type BeatIntent, type Claim, type EvidenceTier, type Finding, type LoopResult,
} from "./validation.ts";
import { ageFindings, parseEpistemic, postDeathFindings, type EvalNarration, type LifeRecord } from "../knowledge.ts";
import type { ApproximateDate } from "../chronology.ts";

export type Stage = 1 | 2 | 3 | 4 | 5;
export type StagedFinding = Finding & { stage: Stage; sourceRef?: string };

export interface EvalBeat { id: string; kind: string; intent: BeatIntent; required: boolean; note?: string }
export interface EvalContext {
  adapter: Adapter; isFiction: boolean; objective: string; beats: EvalBeat[];
  anchors: { key: string; text: string }[]; facts: { id: string; text: string }[];
  /** Future reveal secret terms (Stage 1 only — never shown to the evaluator in prose form). */
  secrets: string[]; controls?: unknown; motifs?: string[]; terminology?: string[];
  /** Decided-as-new-canon dedup keys: those contradictions are intentional, not violations. */
  approvedCanonKeys?: string[];
  /** Phase 3 (optional): narrator knowledge boundaries, life dates and the scene's story date. */
  narration?: EvalNarration; lifeRecords?: LifeRecord[]; sceneDate?: ApproximateDate | null;
}
export interface Prompt { system: string; user: string }
export interface Usage { inputTokens?: number | null; outputTokens?: number | null; costUsd?: number | null }
export interface ModelReply { text: string; usage?: Usage }
export type EvalModel = (p: Prompt) => Promise<ModelReply>;

/** Map a planner beat kind to how its fulfilment is judged. */
export function intentForKind(kind: string): BeatIntent {
  const k = kind.toLowerCase();
  if (/defer|myster|clue|foreshadow|withhold/.test(k)) return "deferred_resolution";
  if (/setup|plant|seed|establish/.test(k)) return "setup_only";
  if (/arc|develop|tension|build|escalat/.test(k)) return "ongoing_arc";
  return "immediate_payoff";
}

/**
 * Genre-adaptive writing-quality rubric (Stage 5). Advisory only: these dimensions are reported as
 * minor/info notes and never block acceptance until calibrated against human editorial review.
 */
export const QUALITY_RUBRICS: Record<string, string[]> = {
  fiction: ["beat execution through action", "POV and voice discipline", "dialogue with subtext", "pacing and tension", "sensory grounding", "character motivation"],
  children: ["age-appropriate vocabulary and syntax", "narrative momentum", "emotional resonance", "sensory wonder", "read-aloud rhythm"],
  narrative_nonfiction: ["scenes grounded in the provided record", "perspective integrity", "clarity of chronology", "no invented detail presented as fact"],
  self_help: ["actionable usefulness", "logical instructional progression", "concrete examples", "clarity without platitudes"],
  business: ["actionable usefulness", "evidence and concrete cases", "logical argument progression", "authority without filler"],
  finance: ["accuracy and stated assumptions", "actionable usefulness", "worked examples", "no invented figures"],
  technical: ["conceptual accuracy", "step-by-step clarity", "precise terminology", "worked examples", "no invented figures"],
  cookbook: ["ingredient, quantity and timing precision", "technique clarity", "sensory description of results", "kitchen practicality"],
  magazine: ["strong lede", "editorial flow", "balanced depth and readability", "clear takeaway"],
};
export const qualityRubric = (adapter: string): string[] => QUALITY_RUBRICS[adapter] ?? QUALITY_RUBRICS.technical;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function buildEvaluatorPrompt(draft: string, ctx: EvalContext): Prompt {
  const beats = ctx.beats.map((b) => `- ${b.id} [${b.intent}${b.required ? ", required" : ""}] ${b.kind}${b.note ? ` — ${clip(b.note, 200)}` : ""}`).join("\n") || "- (no beats planned)";
  const anchors = ctx.anchors.slice(0, 40).map((a) => `- ${a.key}: "${clip(a.text, 200)}"`).join("\n") || "- (none)";
  const facts = ctx.facts.slice(0, 80).map((f) => `- ${f.id}: ${clip(f.text, 200)}`).join("\n") || "- (none)";
  const nonfiction = ctx.adapter === "narrative_nonfiction";
  const n = ctx.narration;
  const secretsBlock = ctx.secrets.length ? `PROTECTED FUTURE TWISTS (validator-only; never quote them back):\n${ctx.secrets.slice(0, 20).map((x, i) => `${i + 1}. ${clip(x, 200)}`).join("\n")}` : "";
  const narrationBlock = n ? [
    `NARRATION: ${n.firstPerson ? "first person" : "limited/third person"}, ${n.vantage}${n.narratorName ? `, narrator ${n.narratorName}` : ""}.`,
    n.inScene.length ? `Narrator knows in this scene:\n${n.inScene.slice(0, 30).map((x) => `- ${clip(x, 160)}`).join("\n")}` : "",
    n.hindsightOnly.length ? `Narrator learned later (hindsight reflection only, never in-scene action):\n${n.hindsightOnly.slice(0, 20).map((x) => `- ${clip(x, 160)}`).join("\n")}` : "",
    n.notYetKnown.length ? `Narrator does NOT know yet:\n${n.notYetKnown.slice(0, 20).map((x) => `- ${clip(x, 160)}`).join("\n")}` : "",
  ].filter(Boolean).join("\n") : "";
  return {
    system: [
      "You are a strict manuscript validator. You never rewrite prose. You report only what the text shows.",
      "Judge four things independently: (2) plan fulfilment, (3) continuity against ESTABLISHED canon and exact anchors,",
      nonfiction ? "(4) factual/epistemic integrity of real-world claims," : "(4) skip epistemic checks (not narrative nonfiction),",
      "(5) writing quality: only unintended narration repetition, broken logic, or incoherence. Style preferences are 'info'.",
      `Writing quality is judged for this genre on: ${qualityRubric(ctx.adapter).join("; ")}. These are advisory: report them as minor or info, never material.`,
      "Setup-only and deferred beats are CORRECT when planted but unresolved. Explaining a deferred mystery early is a violation.",
      "Benign descriptive detail (weather, clothing, atmosphere, sensory texture, ordinary in-scene behaviour) that does not contradict canon is NOT a finding. Report 'material' only for a direct contradiction of an established fact, identity, timeline or exact anchor — never for style or richness of detail.",
      "Every finding must quote a short exact excerpt from the draft and cite the canon id/anchor key it conflicts with when relevant.",
      ctx.secrets.length ? "Disclosure check: a twist is DISCLOSED only when the passage lets the reader understand the twist itself. Mentioning a name, object or place involved, hints and foreshadowing are NOT disclosure. Use certainty 'definite' only when the twist is plainly given away." : "",
      n ? "Epistemic check: flag 'premature_knowledge' when the narrator states as known something they do not know yet, and 'pov_violation' when a first-person/limited narrator states another character's private thoughts or secret actions as fact. Speculation, guesses, lies, mistakes, unreliable narration and (in retrospective narration) clearly framed hindsight are literary devices: set device=true and do not mark them definite." : "",
      "Return JSON only.",
    ].filter(Boolean).join(" "),
    user: [
      `SECTION OBJECTIVE: ${clip(ctx.objective, 600)}`, `PLANNED BEATS:\n${beats}`,
      `EXACT ANCHORS (must match verbatim when used):\n${anchors}`, `ESTABLISHED CANON:\n${facts}`,
      ...(secretsBlock ? [secretsBlock] : []), ...(narrationBlock ? [narrationBlock] : []),
      `DRAFT:\n---\n${draft}\n---`,
      `Respond with: {"beats":[{"id":"","planted":true,"resolved":false,"explanationRevealed":false}],` +
      `"continuity":[{"kind":"fact|identity|timeline|canon|anchor","severity":"material|moderate|minor","message":"","excerpt":"","sourceRef":""}],` +
      `"claims":[{"id":"","tier":"documented|recollection|uncertain|illustrative","sourceProvided":false,"presentedAsFact":true,"excerpt":""}],` +
      `"quality":[{"severity":"moderate|minor|info","message":"","excerpt":""}]` +
      (ctx.secrets.length ? `,"disclosures":[{"secret":1,"disclosed":false,"certainty":"definite|possible","excerpt":""}]` : "") +
      (n ? `,"epistemic":[{"kind":"premature_knowledge|pov_violation","certainty":"definite|possible","device":false,"message":"","excerpt":""}]` : "") + "}",
    ].join("\n\n"),
  };
}

function extractJson(text: string): any {
  const t = text.replace(/```(?:json)?/gi, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("No JSON object found");
  return JSON.parse(t.slice(s, e + 1));
}
const str = (v: unknown, n = 400) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const SEV = ["material", "moderate", "minor"] as const;
const TIERS: EvidenceTier[] = ["documented", "recollection", "uncertain", "illustrative"];

/** Stable key that lets an author decision about one contradiction match a re-detected one. */
export function findingKey(f: Pick<Finding, "code" | "excerpt">): string {
  return `${f.code}:${(f.excerpt ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80)}`;
}

/** Turn the evaluator's JSON into staged findings. Unknown or malformed parts are dropped, never invented. */
export function parseEvaluation(raw: string, ctx: EvalContext, draft = ""): StagedFinding[] {
  const o = extractJson(raw);
  const out: StagedFinding[] = [];
  const reported = new Map(arr(o.beats).map((b) => [str(b?.id, 80), b]));
  const checks: BeatCheck[] = ctx.beats.map((b) => {
    const r = reported.get(b.id) ?? {};
    return { id: b.id, intent: b.intent, required: b.required, planted: r.planted === true, resolved: r.resolved === true, explanationRevealed: r.explanationRevealed === true };
  });
  for (const f of classifyBeats(checks)) out.push({ ...f, stage: 2, sourceRef: f.message.match(/\b[\w.-]+b\d+\b/)?.[0] });

  for (const c of arr(o.continuity)) {
    const kind = str(c?.kind, 20); const sev = SEV.includes(c?.severity) ? c.severity : "minor";
    const canonKind = (["fact", "identity", "timeline", "canon"] as const).find((k) => k === kind) ?? (kind === "anchor" ? "canon" : undefined);
    out.push({ code: kind === "anchor" ? "ANCHOR_MISMATCH" : "CANON_CONTRADICTION", category: "continuity", severity: sev,
      canonKind: sev === "material" ? canonKind : undefined, message: str(c?.message) || "Continuity conflict.", excerpt: str(c?.excerpt, 300) || undefined,
      repairable: true, stage: 3, sourceRef: str(c?.sourceRef, 120) || undefined });
  }

  if (ctx.adapter === "narrative_nonfiction") {
    const claims: (Claim & { excerpt: string })[] = arr(o.claims).map((c, i) => ({
      id: str(c?.id, 40) || `claim${i + 1}`, tier: TIERS.includes(c?.tier) ? c.tier : "uncertain",
      sourceProvided: c?.sourceProvided === true, presentedAsFact: c?.presentedAsFact === true, excerpt: str(c?.excerpt, 300),
    }));
    for (const f of checkEvidence(claims, ctx.adapter)) {
      const id = f.message.match(/Claim (\S+)/)?.[1];
      out.push({ ...f, excerpt: claims.find((c) => c.id === id)?.excerpt || undefined, stage: 4, sourceRef: id });
    }
  }

  for (const q of arr(o.quality)) {
    // Writing quality is advisory: capped below "material" and never a canon route.
    const sev = q?.severity === "moderate" ? "minor" : "info";
    out.push({ code: "WRITING_QUALITY", category: "writing_quality", severity: sev, message: str(q?.message) || "Quality note.", excerpt: str(q?.excerpt, 300) || undefined, repairable: sev === "minor", stage: 5 });
  }

  if (ctx.secrets.length || ctx.narration) for (const f of parseEpistemic(o, draft)) out.push({ ...f, stage: 3 });

  const approved = new Set(ctx.approvedCanonKeys ?? []);
  return out.map((f) => (approved.has(findingKey(f)) && f.stage === 3 ? { ...f, severity: "info", canonKind: undefined, message: `${f.message} (approved canon change)` } : f));
}

export function stageOneFindings(draft: string, ctx: EvalContext): StagedFinding[] {
  return deterministicValidation(draft, { controls: ctx.controls, secrets: ctx.secrets, adapter: ctx.adapter, motifs: ctx.motifs, terminology: ctx.terminology })
    .concat(ctx.lifeRecords?.length ? [...ageFindings(draft, ctx.lifeRecords, ctx.sceneDate ?? null), ...postDeathFindings(draft, ctx.lifeRecords, ctx.sceneDate ?? null)] : [])
    .map((f) => ({ ...f, stage: (f.category === "writing_quality" ? 5 : 1) as Stage }));
}

// ── Targeted repair: only failing excerpts are replaced; the rest of the draft is untouched. ──
export function buildRepairPrompt(draft: string, targets: Finding[], ctx: EvalContext): Prompt {
  const list = targets.slice(0, 12).map((f, i) => `${i + 1}. [${f.code}] ${f.message}${f.excerpt ? ` — excerpt: "${f.excerpt}"` : ""}`).join("\n");
  return {
    system: "You make minimal, surgical corrections to prose. Change only the sentences needed to fix the listed problems. Keep voice, length and everything else identical. Never use markdown. Return JSON only.",
    user: [`SECTION OBJECTIVE: ${clip(ctx.objective, 400)}`, `PROBLEMS:\n${list}`, `DRAFT:\n---\n${draft}\n---`,
      `Respond with {"replacements":[{"find":"exact sentence copied from the draft","replace":"corrected sentence"}]}`].join("\n\n"),
  };
}

/** Applies only replacements whose `find` occurs verbatim; at most 12, each bounded in size. */
export function applyReplacements(draft: string, raw: string): string {
  let o: any; try { o = extractJson(raw); } catch { return draft; }
  let text = draft;
  for (const r of arr(o.replacements).slice(0, 12)) {
    const find = typeof r?.find === "string" ? r.find : ""; const rep = typeof r?.replace === "string" ? r.replace : "";
    if (find.length < 8 || find.length > 2000 || rep.length > 3000 || !text.includes(find)) continue;
    text = text.replace(find, rep);
  }
  return text;
}

export interface PreAcceptanceResult {
  text: string; findings: StagedFinding[]; rounds: number; outcome: LoopResult["outcome"] | "evaluator_unavailable";
  decision: "accept" | "blocked_material" | "needs_author_review"; heldForApproval?: { text: string; ratio: number };
  /** Material canon conflicts the agent resolved itself by conforming the prose to established canon. */
  autoResolved?: { code: string; message: string; excerpt?: string }[];
  usage: { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
}

/**
 * Canon-locked auto-resolution prompt: established canon is always the truth; the conflicting
 * sentences are rewritten to match it exactly. Used for one final autonomous round before a
 * draft is ever held for the author.
 */
export function buildAutoResolvePrompt(draft: string, material: Finding[], ctx: EvalContext): Prompt {
  const list = material.slice(0, 8).map((f, i) => `${i + 1}. [${f.code}] ${f.message}${f.excerpt ? ` — conflicting excerpt: "${f.excerpt}"` : ""}${f.sourceRef ? ` (canon: ${f.sourceRef})` : ""}`).join("\n");
  const truths = [
    ...ctx.anchors.slice(0, 40).map((a) => `- ${a.key}: "${clip(a.text, 200)}"`),
    ...ctx.facts.slice(0, 80).map((f) => `- ${f.id}: ${clip(f.text, 200)}`),
  ].join("\n") || "- (none)";
  return {
    system: "You conform prose to established canon with minimal, surgical edits. Established canon is always true; rewrite only the conflicting sentences so they match it exactly. Keep voice, length and everything else identical. Never use markdown. Return JSON only.",
    user: [`ESTABLISHED CANON (always true):\n${truths}`, `CONFLICTS TO RESOLVE:\n${list}`, `DRAFT:\n---\n${draft}\n---`,
      `Respond with {"replacements":[{"find":"exact sentence copied from the draft","replace":"corrected sentence that matches canon"}]}`].join("\n\n"),
  };
}

/**
 * Full pre-acceptance gate: Stage 1 + one combined evaluator call per validation, ≤2 targeted
 * repair rounds, every revision fully revalidated (regressions are discarded by the loop).
 */
export async function runPreAcceptance(draft: string, ctx: EvalContext, evaluate: EvalModel, repair: EvalModel, opts: { warnRatio?: number } = {}): Promise<PreAcceptanceResult> {
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const track = (u?: Usage) => { usage.calls++; usage.inputTokens += u?.inputTokens ?? 0; usage.outputTokens += u?.outputTokens ?? 0; usage.costUsd += u?.costUsd ?? 0; };
  let unavailable = false;
  const validate = async (t: string): Promise<StagedFinding[]> => {
    const s1 = stageOneFindings(t, ctx);
    try {
      const r = await evaluate(buildEvaluatorPrompt(t, ctx)); track(r.usage);
      return [...s1, ...parseEvaluation(r.text, ctx, t)];
    } catch {
      unavailable = true;
      return [...s1, { code: "EVALUATOR_UNAVAILABLE", category: "continuity", severity: "moderate", message: "Plan, continuity and fact checks could not run; this draft needs your review before it can be accepted.", repairable: false, stage: 3 }];
    }
  };
  const revise = async (t: string, targets: Finding[]) => {
    try { const r = await repair(buildRepairPrompt(t, targets, ctx)); track(r.usage); return applyReplacements(t, r.text); } catch { return t; }
  };
  const loop = await runValidationLoop(draft, validate, revise, opts);
  const all = loop.remaining as StagedFinding[];
  const material = all.some((f) => routeFinding(f) === "canon_reconciliation");
  const decision = material ? "blocked_material" : (unavailable || loop.heldForApproval) ? "needs_author_review" : "accept";
  return { text: loop.text, findings: all, rounds: loop.rounds, outcome: unavailable ? "evaluator_unavailable" : loop.outcome, decision, heldForApproval: loop.heldForApproval, usage };
}
