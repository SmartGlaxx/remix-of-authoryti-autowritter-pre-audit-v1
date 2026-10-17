// Controlled naturalness A/B experiment (pure; the model caller is injected).
// Hard budget: every call reserves its WORST-CASE cost (counted input tokens + max output tokens,
// full uncached rates × provider markup) BEFORE the request. If the reservation would exceed the cap,
// the call is refused and nothing is sent. Fallbacks are disabled: one exact model per role.
// Nothing here writes manuscripts, candidates, acceptance or story memory.
import { getModel } from "../ai/registry.ts";
import { analyzeSection } from "./naturalnessMetrics.ts";
import { runNaturalnessRewrite, charChangeRatio, naturalnessScore, MAX_NATURALNESS_ATTEMPTS, type Prompt } from "./naturalnessRewrite.ts";
import type { NaturalnessFinding } from "./naturalness.ts";

export const EXPERIMENT_CAP_USD = 0.10;
export const EXPERIMENT_MODELS = {
  writer: "anthropic/claude-sonnet-5",
  rewriter: "openai/gpt-6-sol",
  validator: "openai/gpt-6-luna",
} as const;
export const MAX_OUTPUT_TOKENS = { writer: 1600, rewriter: 600, validator: 300 } as const;
export type ExpRole = keyof typeof EXPERIMENT_MODELS;

export class BudgetExceededError extends Error {
  constructor(public readonly needed: number, public readonly remaining: number) { super(`BUDGET_CAP_EXCEEDED: needs $${needed.toFixed(6)}, $${remaining.toFixed(6)} left`); }
}

/** Conservative token count when the provider tokenizer isn't available: ~3 chars per token (over-counts English). */
export const countTokens = (s: string) => Math.ceil((s ?? "").length / 3);

export interface UsageRecord { role: ExpRole; model: string; reserved: number; inputTokens: number; outputTokens: number; cachedInputTokens: number; actual: number }

export class BudgetGuard {
  spent = 0; reservedOpen = 0; readonly log: UsageRecord[] = [];
  constructor(readonly cap = EXPERIMENT_CAP_USD, readonly markup = 1) {
    if (!(cap > 0) || !(markup >= 1)) throw new Error("invalid budget");
  }
  /** Worst case: no cache discount, full max output. Unknown price → refuse (never guess). */
  worstCase(model: string, inputTokens: number, maxOut: number): number {
    const p = getModel(model)?.pricing;
    if (!p || p.inputPerM == null || p.outputPerM == null) throw new Error(`PRICE_UNKNOWN: ${model}`);
    return ((inputTokens * p.inputPerM + maxOut * p.outputPerM) / 1e6) * this.markup;
  }
  reserve(model: string, inputTokens: number, maxOut: number): number {
    const need = this.worstCase(model, inputTokens, maxOut);
    const remaining = this.cap - this.spent - this.reservedOpen;
    if (need > remaining + 1e-12) throw new BudgetExceededError(need, remaining);
    this.reservedOpen += need; return need;
  }
  /** Settle with provider-reported usage; output beyond the reserved max is treated as a breach. */
  settle(role: ExpRole, model: string, reserved: number, u: { inputTokens: number; outputTokens: number; cachedInputTokens?: number }) {
    const p = getModel(model)!.pricing;
    const cached = Math.min(u.cachedInputTokens ?? 0, u.inputTokens);
    const actual = (((u.inputTokens - cached) * p.inputPerM! + cached * (p.cachedInputPerM ?? p.inputPerM!) + u.outputTokens * p.outputPerM!) / 1e6) * this.markup;
    this.reservedOpen -= reserved; this.spent += actual;
    this.log.push({ role, model, reserved, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cachedInputTokens: cached, actual });
    if (actual > reserved + 1e-12) throw new Error(`USAGE_EXCEEDED_RESERVATION: ${model}`);
  }
}

/** Provider call: must send exactly `model`, cap output at `maxOutputTokens`, no fallback, no retry. */
export type ExpCaller = (req: { model: string; system: string; user: string; maxOutputTokens: number }) =>
  Promise<{ text: string; inputTokens: number; outputTokens: number; cachedInputTokens?: number; modelUsed: string }>;

export function guardedCall(guard: BudgetGuard, caller: ExpCaller, role: ExpRole) {
  return async (p: Prompt) => {
    const model = EXPERIMENT_MODELS[role], maxOut = MAX_OUTPUT_TOKENS[role];
    const reserved = guard.reserve(model, countTokens(p.system) + countTokens(p.user), maxOut); // throws before any request
    let r;
    try { r = await caller({ model, system: p.system, user: p.user, maxOutputTokens: maxOut }); }
    catch (e) { guard.settle(role, model, reserved, { inputTokens: countTokens(p.system) + countTokens(p.user), outputTokens: maxOut }); throw e; } // failed call: assume worst case was billed
    if (r.modelUsed !== model) { guard.settle(role, model, reserved, r); throw new Error(`FALLBACK_FORBIDDEN: got ${r.modelUsed}`); }
    guard.settle(role, model, reserved, r);
    return r;
  };
}

// ---- Scenario B flaw injection (deterministic; uses phrases the detectors actually recognize) ----
export const INJECTED = {
  starter: "As the",
  duplicate: "The silence between them stretched into something brittle and thin.",
  stock: ["The truth is,", "At the end of the day,"],
};

export function injectFlaws(original: string): string {
  const paras = original.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out = paras.map((p, i) => {
    if (i < 5) return `${INJECTED.starter} ${["light shifted", "minutes passed", "kettle cooled", "rain thinned", "clock ticked"][i]}, she waited. ${p}`;
    return p;
  });
  out.splice(1, 0, INJECTED.duplicate);
  out.push(`${INJECTED.stock[0]} nothing had changed. ${INJECTED.stock[1]} she still had to choose. ${INJECTED.duplicate}`);
  return out.join("\n\n");
}

/** Free preflight: the flawed copy must trigger starters (≥4), verbatim duplicate and stock phrases. */
export function preflightDetection(flawed: string, opts: { protectedMotifs?: string[]; bookType?: string } = {}) {
  const findings = analyzeSection(flawed, opts);
  const mech = findings.find((f) => f.category === "mechanical_pattern");
  const ev = (mech?.evidence ?? {}) as { starters?: { starter: string; count: number }[]; stockPhrases?: string[]; subtype?: string };
  const checks = {
    repeatedStarters: !!ev.starters?.some((s) => s.starter === INJECTED.starter.toLowerCase() && s.count >= 4),
    verbatimDuplicate: ev.subtype === "verbatim_repetition",
    stockPhrases: (ev.stockPhrases?.length ?? 0) >= 2,
  };
  return { ok: Object.values(checks).every(Boolean), checks, findings };
}

export interface ExperimentReport {
  textA_original: string; textB_flawed: string; textC_revised: string;
  detection: { A: NaturalnessFinding[]; B: NaturalnessFinding[]; C: NaturalnessFinding[] };
  scores: { A: number; B: number; C: number };
  changeRatioBtoC: number; rewriteAttempts: unknown[];
  validation: { before: string; after: string };
  usage: UsageRecord[]; totalUSD: number; capUSD: number; aborted?: string;
}

/** One generation reused for both conditions; B is an isolated in-memory copy. Returns all three texts. */
export async function runExperiment(input: { writerPrompt: Prompt; validatorPrompt: (text: string) => Prompt; writerVoice?: string }, caller: ExpCaller, guard = new BudgetGuard()): Promise<ExperimentReport> {
  const rep: ExperimentReport = { textA_original: "", textB_flawed: "", textC_revised: "", detection: { A: [], B: [], C: [] }, scores: { A: 0, B: 0, C: 0 }, changeRatioBtoC: 0, rewriteAttempts: [], validation: { before: "", after: "" }, usage: guard.log, totalUSD: 0, capUSD: guard.cap };
  const fin = (aborted?: string) => ({ ...rep, totalUSD: +guard.spent.toFixed(6), aborted });
  try {
    rep.textA_original = (await guardedCall(guard, caller, "writer")(input.writerPrompt)).text;
    rep.textB_flawed = injectFlaws(rep.textA_original);
    const pre = preflightDetection(rep.textB_flawed);
    rep.detection.A = analyzeSection(rep.textA_original); rep.detection.B = pre.findings;
    if (!pre.ok) return fin(`PREFLIGHT_FAILED: ${JSON.stringify(pre.checks)}`); // no rewrite money spent
    rep.validation.before = (await guardedCall(guard, caller, "validator")(input.validatorPrompt(rep.textB_flawed))).text;
    const rw = await runNaturalnessRewrite(rep.textB_flawed, { mode: "analyze_and_rewrite", writerVoice: input.writerVoice }, async (p) => ({ text: (await guardedCall(guard, caller, "rewriter")(p)).text }));
    rep.textC_revised = rw.text; rep.rewriteAttempts = rw.attempts; rep.detection.C = rw.after;
    rep.validation.after = (await guardedCall(guard, caller, "validator")(input.validatorPrompt(rep.textC_revised))).text;
  } catch (e) { return fin((e as Error).message); }
  finally {
    rep.scores = { A: naturalnessScore(rep.detection.A), B: naturalnessScore(rep.detection.B), C: naturalnessScore(rep.detection.C) };
    rep.changeRatioBtoC = rep.textC_revised ? charChangeRatio(rep.textB_flawed, rep.textC_revised) : 0;
  }
  return fin();
}
export const MAX_REWRITE_CALLS = MAX_NATURALNESS_ATTEMPTS;
