import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildVoiceManifest } from "../_shared/writers/manifest.ts";
import { renderExpressionBlock, resolveDivergence } from "../_shared/writers/sliders.ts";
import { effectiveSlidersFor } from "../_shared/writers/manifest.ts";
import { renderWriterPrompt, resolveWriter } from "../_shared/writers/personas.ts";
import { lensFor } from "../_shared/writers/toneMatch.ts";
import { openingDirective } from "../_shared/writers/opening.ts";
import { analyzeSection } from "../_shared/writers/naturalnessMetrics.ts";
import { loadProtectedMotifs } from "../_shared/writers/learningRepo.ts";
import { resolveNaturalnessMode } from "../_shared/writers/naturalness.ts";
import { runNaturalnessRewrite } from "../_shared/writers/naturalnessRewrite.ts";
import { resolveLiteraryReviser, LiteraryBudget, buildLiteraryPrompt } from "../_shared/writers/literaryReviser.ts";
import { literaryCaller } from "../_shared/writers/literaryReviserServer.ts";
import { recordSignals } from "../_shared/writers/learningRepo.ts";
import { renderActiveOverlays } from "../_shared/writers/learning.ts";
import { buildLedger, planOpeningStrategy, renderOpeningStrategyBlock } from "../_shared/writers/rhetoric.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { buildNarrativeContext } from "../_shared/narrative/context.ts";
import { loadNarrativeRows, verifyBookOwnership } from "../_shared/narrative/supabaseRepo.ts";
import { buildAdaptiveContext, resolveContextEngine, type ContextEngine } from "../_shared/narrative/adaptiveCandidates.ts";
import { estimateCostUSD } from "../_shared/ai/registry.ts";
import { streamAI, toChatSSE, statusForAIError } from "../_shared/ai/client.ts";
import { createAIDeps, loadBookModelConfig } from "../_shared/ai/server.ts";
import { LEGACY_PICKER_MAP, resolveModelForRole } from "../_shared/ai/roles.ts";
import { createLeaseHeartbeat, LEASE_TTL_SECONDS, renderPlanBlock, requireApprovedPlan, resolvePipeline, type Heartbeat, type Pipeline } from "../_shared/narrative/planning/pipeline.ts";
import { loadBlueprintGate, loadProgressiveState, type ProgressiveState } from "../_shared/narrative/planning/pipelineRepo.ts";
import { buildPlanningAwareContext, futureSecrets } from "../_shared/narrative/planning/planningContext.ts";
import { buildEvalContext } from "../_shared/narrative/planning/evalContext.ts";
import { loadNarratorContext, type NarratorContext } from "../_shared/narrative/knowledgeRepo.ts";
import { modelCallers, persistOutcome, runPreAcceptance } from "../_shared/narrative/planning/preAcceptanceServer.ts";
import { contentHash } from "../_shared/narrative/extraction.ts";
import { renderWholeBookMemory } from '../_shared/narrative/sectionMemory.ts';

// ── Security Config ──
const MAX_PAYLOAD_BYTES = 200_000;

// ── In-memory novel-text cache (per Deno isolate) ──
// Key: novel_full_v1_{novel_id}_{total_char_count}
// Value: { text, expires }
const NOVEL_TEXT_CACHE = new Map<string, { text: string; expires: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CONTEXT_CHARS = 100_000;

function getCachedNovelText(key: string): string | null {
  const entry = NOVEL_TEXT_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { NOVEL_TEXT_CACHE.delete(key); return null; }
  return entry.text;
}
function setCachedNovelText(key: string, text: string) {
  NOVEL_TEXT_CACHE.set(key, { text, expires: Date.now() + CACHE_TTL_MS });
  // Light eviction: cap to 200 entries
  if (NOVEL_TEXT_CACHE.size > 200) {
    const oldest = NOVEL_TEXT_CACHE.keys().next().value;
    if (oldest) NOVEL_TEXT_CACHE.delete(oldest);
  }
}
/** Drops the partial sentence at the START of a tail slice (keeps everything after the first boundary). */
export function trimToSentenceBoundary(textChunk: string): string {
  const first = /[.!?]\s+(?=[A-Z])/.exec(textChunk);
  if (!first) return textChunk;
  return textChunk.slice(first.index + first[0].length);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── WAF: Block suspicious patterns ──
function wafCheck(req: Request): string | null {
  const ua = (req.headers.get("user-agent") || "").toLowerCase();
  const blocked = ["sqlmap", "nikto", "nessus", "masscan", "zgrab"];
  for (const b of blocked) {
    if (ua.includes(b)) return `Blocked user-agent: ${b}`;
  }
  return null;
}

// ── Prompt injection detection ──
function detectPromptInjection(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const patterns = [
    /ignore\s+(all\s+)?previous\s+instructions/i,
    /you\s+are\s+now\s+/i,
    /system\s*:\s*/i,
    /\[INST\]/i,
    /<<SYS>>/i,
    /forget\s+(everything|all|your)\s/i,
    /override\s+(your|the)\s+/i,
    /act\s+as\s+(if|a|an)\s+/i,
  ];
  return patterns.some(p => p.test(text));
}

// ── Input validation ──
function validateInput(body: any): string | null {
  if (!body || typeof body !== "object") return "Invalid request body";
  if (!body.book || typeof body.book !== "object") return "Missing book data";
  if (typeof body.chapterIndex !== "number" || body.chapterIndex < 0) return "Invalid chapterIndex";
  if (typeof body.subsectionIndex !== "number" || body.subsectionIndex < 0) return "Invalid subsectionIndex";
  if (!body.book.title || typeof body.book.title !== "string") return "Missing book title";
  if (body.book.title.length > 500) return "Book title too long";
  if (!body.book.theme || typeof body.book.theme !== "string") return "Missing book theme";
  if (body.book.theme.length > 2000) return "Theme too long";
  
  const fieldsToCheck = [body.book.title, body.book.theme, body.book.subtitle].filter(Boolean);
  for (const field of fieldsToCheck) {
    if (detectPromptInjection(field)) return "Input contains prohibited patterns";
  }
  
  return null;
}

// ── Auth helper ──
async function getAuthUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  
  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  
  try {
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims) {
      const { data: userData, error: userError } = await supabase.auth.getUser(token);
      if (userError || !userData?.user) return null;
      return { user: { id: userData.user.id, email: userData.user.email || "" }, supabase };
    }
    return { user: { id: data.claims.sub as string, email: data.claims.email as string }, supabase };
  } catch {
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser(token);
      if (userError || !userData?.user) return null;
      return { user: { id: userData.user.id, email: userData.user.email || "" }, supabase };
    } catch {
      return null;
    }
  }
}

// ── Rate limit helper ──
async function checkRateLimit(userId: string, functionName: string) {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await supabase.rpc("check_rate_limit", {
    _user_id: userId, _function_name: functionName, _max_per_hour: 60, _max_per_day: 500,
  });
  if (error) { console.error("Rate limit check failed:", error); return true; }
  return data as boolean;
}

// ── Audit log helper ──
async function auditLog(userId: string, action: string, resourceType: string, resourceId?: string, metadata?: Record<string, unknown>) {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  await supabase.from("audit_logs").insert({ user_id: userId, action, resource_type: resourceType, resource_id: resourceId, metadata: metadata || {} });
}

// ── Language guidelines ──
function getLanguageGuidelines(band: number): string {
  switch (band) {
    case 5: return `- Use simple vocabulary and short sentences\n- Basic grammar structures only\n- Maximum sentence length: 10-12 words average`;
    case 6: return `- Moderately simple vocabulary with some descriptive words\n- Mix of simple and compound sentences\n- Maximum sentence length: 15-18 words average`;
    case 7: return `- Standard vocabulary appropriate for general readers\n- Varied sentence structures\n- Average sentence length: 18-22 words`;
    case 8: return `- Wide vocabulary range including some academic/technical terms\n- Complex grammatical structures used naturally\n- Varied sentence lengths for rhythm and effect`;
    case 9: return `- Extensive and precise vocabulary including specialized terminology\n- Full range of grammatical structures\n- Advanced rhetorical devices and scholarly conventions`;
    default: return `- Standard vocabulary appropriate for general readers\n- Varied sentence structures`;
  }
}

// ── Pacing rules ──
function getPacingRules(hookFreq: number, vel: number, isNarr: boolean, hookInt: number, sceneWords: number, controls: any, closedWorld = false): string {
  let rules = `WRITING CONTROLS:
- Velocity: ${vel}/10 (${vel > 6 ? "fast-paced, action-driven" : vel > 3 ? "balanced pacing" : "slow, descriptive"})
- Creativity: ${controls.creativity}/10
- Scope: ${controls.scope}/10
- Hook Frequency: ${hookFreq}/10 (inject a hook every ~${hookInt} paragraph(s))`;

  if (!isNarr && hookFreq <= 3) return rules;

  rules += `

PACING & MOMENTUM RULES (STRICTLY ENFORCED):
1. HOOK INJECTION: Every ${hookInt} paragraph(s), inject a hook — a compelling question, revelation, action beat, scene change, ${closedWorld ? "planned character entrance" : "new character entrance"}, or dialogue shift.
2. NO RUMINATION: Never spend more than ${hookFreq >= 7 ? "1-2" : "2-3"} sentences on internal feelings before moving forward.
3. SCENE MOMENTUM: Every ${sceneWords} words maximum, something MUST change.
4. DYNAMIC PACING: Treat each paragraph like a cut in a film.
5. DIALOGUE BREAKS RUMINATION: If internal monologue exceeds 2 sentences, interrupt with dialogue or action.
6. SHOW DON'T DWELL: One vivid sentence of observation, then the next beat.
7. CONTENT MIX: Aim for roughly ${hookFreq >= 7 ? "60% action/events, 25% dialogue, 15% internal thought" : "50% action/events, 30% dialogue, 20% internal thought"}.
8. OPEN LOOPS: Plant unanswered questions and curiosity gaps throughout.
9. IN MEDIAS RES: Drop into the middle of the action.
10. PATTERN INTERRUPTS: Break predictable rhythms.`;

  return rules;
}

// ── Build system prompt (STATIC portion for cache optimization) ──
function buildStaticSystemPrompt(book: any, band: number, isScreenplay: boolean, isChildren: boolean, isComic: boolean, isNarrative: boolean, controls: any, configuredBansOnly = false): string {
  const languageGuidelines = getLanguageGuidelines(band);
  const hookFrequency = controls?.hookFrequency ?? 5;
  const velocity = controls?.velocity ?? 5;
  const hookInterval = Math.max(1, Math.round(9 - (hookFrequency - 1) * (8 / 9)));
  const sceneChangeWords = Math.max(150, Math.round(600 - ((velocity + hookFrequency) / 2 - 1) * 50));
  const pacingRules = getPacingRules(hookFrequency, velocity, isNarrative, hookInterval, sceneChangeWords, controls, configuredBansOnly);

  const screenplayRules = isScreenplay ? `
SCREENPLAY FORMAT (MANDATORY — you are writing a screenplay, NOT prose):
You MUST use standard screenplay/stage-play formatting throughout. Never write in prose paragraph form.

FORMAT RULES:
- Scene headings: ALL CAPS, e.g. "INT. COFFEE SHOP — MORNING" or "EXT. ROOFTOP — NIGHT"
- Character names before dialogue: Proper case, on their own line
- Dialogue: Under the character name, indented
- Parentheticals: In parentheses under character name, before dialogue
- Action/stage directions: Present tense, lean descriptions
- Transitions: FADE IN:, CUT TO:, FADE TO BLACK, SMASH CUT TO: — used sparingly
- Keep action lines SHORT — 1-3 sentences max per block
- Show, don't tell — no internal thoughts unless delivered as V.O.
- NO prose paragraphs. Every line must serve the camera or the actor.
` : "";

  const childrensEngineRules = isChildren ? `
CHILDREN'S BOOK ENGINE (AGE-AWARE, SIMPLE, VISUAL-FIRST) — STRICTLY ENFORCED:
You are a structured children's book creation engine for ages 1–9. Generate simple, engaging, age-appropriate stories with strong visuals and emotional clarity.

CORE PRINCIPLES:
- Use simple vocabulary a young child can follow.
- Use short sentences. 2–3 sentences per paragraph (1–3 absolute max).
- Use clear emotional cues (happy, scared, brave, surprised, kind).
- Maintain linear storytelling — beginning (setup), middle (problem), resolution (clear ending).
- Each section: 2–5 paragraphs maximum.

CHARACTER DESIGN:
- Only 1–3 main characters total across the book.
- Each character has one or two clear traits: kind, curious, brave, shy, playful.
- No complex motivations, no moral grey areas.

STORY RULES:
- One main problem only. No subplots.
- Clear cause → effect chain. Every event leads naturally to the next.

TONE RULES:
- Warm, positive, encouraging.
- No dark themes, no fear without resolution, no violence, no death, no scary imagery.

INTERACTION ELEMENTS (use sparingly, where natural):
- Gentle repetition for rhythm ("And then…", "Again and again…").
- Soft questions to the reader ("What do you think happened next?") only if the section calls for it.

COMPLETION RULE:
- The book is complete when the problem is resolved clearly, an emotional lesson is delivered, and the ending is satisfying and simple.

META RULE: Clarity > creativity. Simplicity > complexity.
` : "";

  const comicEngineRules = isComic ? `
COMIC / GRAPHIC NOVEL ENGINE (PANEL-BASED, VISUAL-FIRST STORYTELLING) — STRICTLY ENFORCED:
You are a structured comic creation engine. Story is told through panels, dialogue, and visual action. Text must be minimal. Visuals carry the narrative.

OUTPUT FORMAT (MANDATORY):
Each subsection is a SCENE made of 4–8 PANELS. Output panels as plain prose blocks in this exact pattern, one panel after another, with a blank line between panels:

PANEL 1
Description: [what is happening visually — characters, setting, action, lighting, mood]
Camera: [close-up | medium | wide | over-the-shoulder | bird's-eye | low-angle]
Emotion: [the dominant feeling of the panel]
[CHARACTER NAME]: "Short, punchy line of dialogue."
[CHARACTER NAME]: "Another short line."
(Caption or SFX in parentheses if needed: BOOM, WHOOSH, "Later that night…")

PANEL 2
…and so on.

PANEL RULES:
- 4–8 panels per scene. Never fewer than 4, never more than 8.
- Every panel must include a Description and a Camera angle. Emotion is required when characters are present.
- Dialogue is optional per panel — silent visual panels are encouraged for pacing.
- Dialogue lines must be SHORT and punchy. No long paragraphs. Natural speech only.
- Captions (narration) are allowed sparingly — wrap them in parentheses, e.g. (Three days later.).
- SFX are allowed in parentheses, e.g. (CRASH!), (whisper).

VISUAL DIRECTION:
- Each panel's Description must specify: character appearance and pose, environment, lighting, and mood.
- Recurring characters keep a consistent visual identity (clothing, hair, distinguishing features) across all panels.
- Show, don't tell. Action and expression carry meaning — never narrate inner monologue.

PACING:
- Each scene must move the story forward — introduce or escalate conflict.
- End every scene with tension, a beat of emotion, or a clean transition into the next scene.
- Never stall. No filler panels.

COMPLETION:
- The story ends when the main conflict is resolved and a final emotional payoff is delivered.

META RULE: Show > tell. Panels > paragraphs.
` : "";

  const userBannedWords: string[] = Array.isArray(controls?.bannedWords) ? controls.bannedWords : [];
  const bannedWordsBlock = userBannedWords.length > 0
    ? `\n- The following words and their close variants MUST NEVER appear in the output: ${userBannedWords.join(", ")}.`
    : "";

  const activeWriterPersona = resolveWriter(controls, book.bookType);
  const writerBlock = renderWriterPrompt(activeWriterPersona, book.bookType);
  // Book tone chosen in Book Variants: applied to every paragraph through this writer's lens (absent = prompt unchanged).
  const bookTone = typeof controls?.bookTone === "string" && controls.bookTone.trim() ? controls.bookTone.trim() : "";
  const toneLensBlock = bookTone ? `\nBOOK TONE (applies to EVERY paragraph, including transitions, description and dialogue): "${bookTone}". ${lensFor(activeWriterPersona, bookTone)} Never drift out of this tone, and never let it override the writer's own voice.\n` : "";
  return `You are a master writer creating content for a ${book.bookType} book.

${writerBlock}
${isScreenplay ? "You are writing in SCREENPLAY FORMAT. Every line of output must follow screenplay conventions." : ""}
${isChildren ? "You are writing a CHILDREN'S BOOK for ages 1–9. Every line must obey the Children's Book Engine rules below." : ""}
${isComic ? "You are writing a COMIC / GRAPHIC NOVEL. Every subsection must be delivered as panel-based output following the Comic Engine rules below." : ""}

BOOK CONTEXT:
- Title: "${book.title}"
- Theme: ${book.theme}
- Audience: ${book.audience}
- POV: ${book.pov}
- Tone: ${book.toneProfile.primary} (formality: ${book.toneProfile.formality}/10, emotion: ${book.toneProfile.emotionalIntensity}/10)

${renderExpressionBlock(effectiveSlidersFor(book), resolveDivergence(book.controls))}${toneLensBlock}

LANGUAGE & GRAMMAR LEVEL (IELTS Band ${band}):
${languageGuidelines}

${screenplayRules}
${childrensEngineRules}
${comicEngineRules}

${pacingRules}

${openingDirective(book.bookType)}

ANTI-REPETITION RULE (STRICTLY ENFORCED):
- NEVER rewrite, paraphrase, or revisit scenes, dialogue, descriptions, or events that already appeared in the previous section.
- If the previous section ended mid-scene, continue from exactly that point — do not restart the scene.
- Each subsection must introduce NEW events, NEW dialogue, or NEW developments. Zero overlap with previous content.${configuredBansOnly ? `

CLOSED-WORLD RULE (PLANNED BOOK — STRICTLY ENFORCED):
- Expand the approved plan; do not create new story facts. "New developments" means the planned events of this section, never invented ones.
- Use only characters already in the cast or named in the plan. Never invent a new named person, relationship, backstory, consequential location, discovery or plot complication.
- Unnamed background figures (a guard, a passer-by) may appear only if they stay unnamed and change nothing.
- Gestures, sensory detail, atmosphere and dialogue wording remain fully yours.` : ""}

${isNarrative && !isChildren ? `CHARACTER DESCRIPTION (MANDATORY for every narrative book — novel, serial, short story, biography, memoir, drama, comic):
- When a character first appears in a scene, render them in the tradition of James Hadley Chase: lean, sensory, and instantly cinematic.
- Show physical specifics that imply personality — the cut of the jaw, the set of the mouth, the weight behind the eyes, the fall of the hair, the way the suit hangs on the shoulders, the shoes, the hands, the smell of cologne or sweat or rain.
- Layer in posture, gait, micro-expressions, and the small habits that betray inner life (a thumb worried over a ring, a glance held a beat too long, a smile that does not reach the eyes).
- Anchor the description in the viewpoint character's reaction — what attracts, repels, threatens, or unsettles them about this person.
- Do NOT dump a paragraph of static description. Weave the details into action, dialogue, and movement so the reader sees the character without ever feeling told.
- Recurring characters must keep their established physical signature — never contradict earlier descriptions; deepen them with new angles instead.
- Aim for descriptions that are vivid enough that a reader could close their eyes and recognise the character on a crowded street.` : ""}

FORMAT & WORD BAN RULES (STRICTLY ENFORCED):
- NEVER use markdown formatting such as **, *, ##, or any other markdown syntax in your output. Write in plain prose only.
${configuredBansOnly ? "" : `- NEVER use the word "magic" or "magical" in any context. Find more specific, vivid alternatives.\n`}- Do not use asterisks for emphasis.
- NEVER prefix any line with literal labels like "Hook:", "Teaser:", "Scene:", "Beat:", "Note:", "[HOOK]", "[TEASER]", or any meta-tag. Hooks and teasers must read as natural narrative — the reader must never be told they are reading a hook or a teaser.
- If a teaser or hook is required, write it as ordinary prose that opens the section organically. No tags, no brackets, no labels of any kind.${bannedWordsBlock}`;
}

// ── Build variable user prompt (changes per subsection) ──
function buildVariablePrompt(
  book: any, chapter: any, subsection: any,
  previousNovelText: string | undefined,
  previousSummary: string | undefined, previousRawContent: string | undefined,
  tonalAnchors: string[] | undefined, teaserStyle: string | undefined,
  isScreenplay: boolean, isChildren: boolean, isComic: boolean,
  targetWordsPerSubsection: number | undefined,
  reqAutomationLevel: string | undefined
): string {
  let prompt = `CURRENT POSITION:
- Chapter ${chapter.chapterNumber}: "${chapter.title}"
- Subsection: "${subsection.title}"
- Goal: ${subsection.goal || "Continue the narrative"}

`;

  if (previousNovelText && previousNovelText.length > 0) {
    prompt += `[PREVIOUS_NOVEL_TEXT] (the entire prior novel text, verbatim — DO NOT repeat any of this content; continue seamlessly from where it ends):
---
${previousNovelText}
---

`;
  } else {
    if (previousSummary) prompt += `PREVIOUS SECTION SUMMARY:\n${previousSummary}\n\n`;
    if (previousRawContent) {
      prompt += `PREVIOUS SECTION ENDING (last ~1000 words — DO NOT repeat any of this content):\n---\n${previousRawContent}\n---\n\n`;
    }
  }

  if (tonalAnchors?.length > 0) {
    prompt += `TONAL ANCHORS (match this style):\n${tonalAnchors.join("\n\n")}\n\n`;
  }

  if (isChildren) {
    prompt += `CHILDREN'S BOOK SECTION REQUIREMENTS:
- Write 100-250 words maximum for this section.
- 2–5 short paragraphs. Each paragraph 1–3 sentences (target 2–3).
- Use simple, vivid words a 1–9 year-old child can follow.
- Include warm dialogue and clear action.
- Show one clear emotion arc: setup → small problem → reassurance.
- Add sensory cues a young child notices (colors, sounds, textures, tastes).
- End the section with a soft hook OR a gentle resolution beat.\n\n`;
  } else if (isComic) {
    prompt += `COMIC SECTION REQUIREMENTS:
- Output this subsection as 4–8 PANELS using the panel format defined in the system rules.
- Every panel: PANEL N header line, then "Description:", "Camera:", "Emotion:", optional dialogue lines, optional caption/SFX in parentheses.
- Keep dialogue short and punchy. No prose paragraphs anywhere in the output.
- Maintain consistent visual identity for any character that appeared in earlier panels.
- End the scene with tension or a clean transition into the next scene.\n\n`;
  } else if (reqAutomationLevel === "guided") {
    prompt += `GUIDED MODE — HARD LIMIT (STRICTLY ENFORCED):
- Write EXACTLY 2–3 sentences. No more.
- Total output must be under 80 words.\n\n`;
  } else {
    prompt += `Write approximately ${targetWordsPerSubsection || 600} words for this subsection.\n\n`;
  }

  if (teaserStyle && teaserStyle !== "none" && !isComic && !isChildren) {
    prompt += `SECTION OPENING STYLE:
Open this section with a single line in the "${teaserStyle}" style — but write it as plain prose. Do NOT label it. Do NOT wrap it in any tags or brackets. Do NOT prefix it with words like "Hook:", "Teaser:", or similar. The opening line must read as natural narrative that the reader experiences without any meta-commentary.
${teaserStyle === "mood-setter" ? "It should evoke a date, location, weather, or atmospheric stamp." : ""}
${teaserStyle === "cryptic-open-loop" ? "It should be a single cryptic, intriguing sentence." : ""}
${teaserStyle === "character-voice-drop" ? "It should be a one-line thought or fragment in a character's voice." : ""}\n\n`;
  }

  if (isComic) {
    prompt += `Write ONLY the panels for this subsection, in the panel format. Do not include titles, headers, or any meta-labels.`;
  } else if (isChildren) {
    prompt += `Write ONLY the prose for this section. No titles, no headers, no meta-labels. Keep it warm, simple, and child-safe.`;
  } else {
    prompt += `Write ONLY the content for this subsection. ${isScreenplay ? "Use proper screenplay formatting throughout." : "Do not include titles or headers. Do not include any meta-labels like \"Hook:\" or \"Teaser:\". Match the established tone and style."} Create engaging, high-quality ${isScreenplay ? "screenplay scenes" : "prose"}.`;
  }

  return prompt;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  // Fail-closed: this service has no free stand-in, so test mode must never reach a paid model.
  if (req.headers.get("x-ai-test-mode") === "1") {
    return new Response(JSON.stringify({ error: "test_mode_blocked" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    // WAF check
    const wafResult = wafCheck(req);
    if (wafResult) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Payload size check
    const contentLength = parseInt(req.headers.get("content-length") || "0");
    if (contentLength > MAX_PAYLOAD_BYTES) {
      return new Response(JSON.stringify({ error: "Payload too large" }), {
        status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auth check
    const auth = await getAuthUser(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit
    const allowed = await checkRateLimit(auth.user.id, "generate-content");
    if (!allowed) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const validationError = validateInput(body);
    if (validationError) {
      return new Response(JSON.stringify({ error: validationError }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { book, chapterIndex, subsectionIndex, previousSummary, previousRawContent, tonalAnchors, ieltsBand, targetWordsPerSubsection, teaserStyle, automationLevel: reqAutomationLevel, aiModel: reqAiModel } = body;
    // The browser sends a one-chapter outline slice (chapterIndex is then 0); the real chapter
    // position drives story memory, so it arrives separately. Missing = old clients.
    const absChapter: number = Number.isInteger(body.absoluteChapterIndex) && body.absoluteChapterIndex >= 0 && body.absoluteChapterIndex <= 999 ? body.absoluteChapterIndex : chapterIndex;

    // Dry run: assemble prompts exactly as a real write would, return them, make no AI call,
    // charge nothing and write nothing. Used to verify the deployed context pipeline.
    const dryRun = body.dryRun === true;

    // ── Credit & daily word cap enforcement ──
    const estimatedWords = targetWordsPerSubsection || 600;
    const adminSupabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    
    const { data: creditCheck, error: creditError } = dryRun ? { data: { allowed: true }, error: null } : await adminSupabase.rpc(
      "check_and_deduct_word_credits",
      { _user_id: auth.user.id, _estimated_words: estimatedWords, _skip_daily_cap: true } // daily word limit removed by owner request
    );

    if (creditError) { console.error("Credit check failed:", creditError); throw new Error("Credit check failed"); }

    const creditResult = creditCheck as { allowed: boolean; reason?: string };
    if (!creditResult.allowed) {
      return new Response(
        JSON.stringify({ error: creditResult.reason || "Credit limit reached" }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const chapter = book.outline?.chapters[chapterIndex];
    const subsection = chapter?.subsections[subsectionIndex];
    if (!chapter || !subsection) throw new Error("Invalid chapter or subsection index");

    // Audit log
    if (!dryRun) await auditLog(auth.user.id, "generate_content", "book", book.id, { chapterIndex, subsectionIndex, chapterTitle: chapter.title });

    const isChildren = book.bookType === "children";
    const isComic = book.bookType === "comic";
    const isChildrensBook = isChildren || isComic; // legacy: skip full-text caching for these
    const isNarrative = ["novel", "fiction-serial", "short-story", "children", "comic", "biography", "memoir", "drama"].includes(book.bookType);
    const isScreenplay = book.bookType === "drama";
    const band = ieltsBand || 7;

    // ── Phase 2D A/B switch: read from the saved book (never trusted from the client). Default legacy. ──
    const startedAt = Date.now();
    let engine: ContextEngine = "legacy";
    let pipeline: Pipeline = "current";
    let serverOutline: any = null;
    let bookControls: unknown = null;
    if (book.id) {
      try {
        const { data: eb } = await adminSupabase.from("books").select("controls, user_id, outline").eq("id", book.id).maybeSingle();
        if (eb && eb.user_id === auth.user.id) { engine = resolveContextEngine(eb.controls); pipeline = resolvePipeline(eb.controls); bookControls = eb.controls; serverOutline = eb.outline; }
      } catch (e) { console.warn("[context-engine] lookup failed, using legacy:", e instanceof Error ? e.message : e); }
    }

    // ── Phase F: opt-in progressive pipeline (books.controls.planning_pipeline = "progressive"). ──
    // Gate first (previous section accepted + in story memory, no undecided serious contradiction),
    // then a generation lease. Books without the flag never reach this block.
    let progressive: ProgressiveState | null = null;
    let lease: { lease_id: string; fencing_token: number; worker: string } | null = null;
    let heartbeat: Heartbeat | null = null;
    if (pipeline === "progressive" && book.id) {
      progressive = await loadProgressiveState(adminSupabase, book.id, auth.user.id, book.bookType, serverOutline, absChapter, subsectionIndex);
      if (!progressive.gate.ok && !dryRun) {
        return new Response(JSON.stringify({ error: progressive.gate.reason, code: progressive.gate.code }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Explicit progressive selection never silently downgrades to unplanned writing.
      const planReq = requireApprovedPlan(progressive.plan);
      if (!planReq.ok && !dryRun) {
        return new Response(JSON.stringify({ error: planReq.reason, code: planReq.code }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Stage 2 completion: required-blueprint books need an approved chapter blueprint with every person registered.
      const bpGate = await loadBlueprintGate(adminSupabase, book.id, auth.user.id, bookControls, absChapter);
      if (!bpGate.ok && !dryRun) {
        return new Response(JSON.stringify({ error: bpGate.reason, code: bpGate.code }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (!dryRun) {
        const worker = `gc_${crypto.randomUUID()}`;
        const { data: acq, error: acqErr } = await adminSupabase.rpc("acquire_generation_lease", { p_book_id: book.id, p_user_id: auth.user.id, p_chapter: absChapter, p_sub: subsectionIndex, p_worker: worker, p_ttl_seconds: LEASE_TTL_SECONDS });
        if (acqErr || !acq?.acquired) {
          return new Response(JSON.stringify({ error: "This section is already being written elsewhere. Try again shortly.", code: "LEASE_HELD" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        lease = { lease_id: acq.lease_id, fencing_token: Number(acq.fencing_token), worker };
        const l = lease;
        heartbeat = createLeaseHeartbeat(async () => {
          const { data, error } = await adminSupabase.rpc("renew_generation_lease", { p_lease_id: l.lease_id, p_worker: l.worker, p_token: l.fencing_token, p_ttl_seconds: LEASE_TTL_SECONDS });
          return !error && data?.renewed === true;
        }, { onLost: () => console.warn("[phase-f] lease lost; this worker will not commit") });
      }
    }
    const runMetrics: Record<string, unknown> = { engine, profile_id: null, context_words: 0, candidates: 0, included: 0, omitted: {}, fell_back: false };

    // ── Fetch full prior novel text (with in-memory cache) for narrative books ──
    let previousNovelText: string | undefined;
    if (engine === "legacy" && isNarrative && book.id && !isChildrensBook) {
      try {
        // Lookup current char count to build cache key (changes invalidate cache)
        const { data: bookRow } = await adminSupabase
          .from("books")
          .select("full_text, total_char_count, user_id")
          .eq("id", book.id)
          .maybeSingle();

        if (bookRow && bookRow.user_id === auth.user.id) {
          // Content-hash versioning: any change to the manuscript (even same-length
          // continuity revisions) yields a new key, so stale text is never served.
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bookRow.full_text || ""));
          const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
          const cacheKey = `novel_full_v2_${book.id}_${hash}`;
          let cached = getCachedNovelText(cacheKey);
          if (!cached) {
            let fullText = bookRow.full_text || "";
            if (fullText.length > MAX_CONTEXT_CHARS) {
              fullText = trimToSentenceBoundary(fullText.slice(-MAX_CONTEXT_CHARS));
            }
            setCachedNovelText(cacheKey, fullText);
            cached = fullText;
            console.log(`[novel-cache] MISS key=${cacheKey} chars=${fullText.length}`);
          } else {
            console.log(`[novel-cache] HIT key=${cacheKey} chars=${cached.length}`);
          }
          previousNovelText = cached;
        }
      } catch (e) {
        console.warn("[novel-cache] full_text fetch failed:", e);
      }
    }

    // ── Build prompts with cache-optimized structure ──
    // Static system prompt = CACHE ANCHOR (identical across subsections of same book)
    const systemPrompt = buildStaticSystemPrompt(book, band, isScreenplay, isChildren, isComic, isNarrative, book.controls, pipeline === "progressive");
    
    // Variable user prompt = changes per subsection (not cached)
    // Planned books write the full planned section: the Guided 2–3 sentence cap never applies to them.
    const effLevel = progressive && reqAutomationLevel === "guided" ? "assisted" : reqAutomationLevel;
    const plannedWords = Number(serverOutline?.chapters?.[absChapter]?.subsections?.[subsectionIndex]?.targetWords)
      || Number((progressive?.plan as any)?.section?.targetWords) || Number(subsection?.targetWords) || 0;
    const effTarget = progressive && plannedWords > 0 ? plannedWords : targetWordsPerSubsection;
    const legacyPrompt = () => buildVariablePrompt(
      book, chapter, subsection,
      previousNovelText,
      previousSummary, previousRawContent, tonalAnchors, teaserStyle,
      isScreenplay, isChildren, isComic, effTarget, effLevel
    );
    let userPrompt = engine === "adaptive"
      // Adaptive: prior prose comes only from the assembled context, never from client-sent text.
      ? buildVariablePrompt(book, chapter, subsection, undefined, undefined, undefined, tonalAnchors, teaserStyle,
          isScreenplay, isChildren, isComic, effTarget, effLevel)
      : legacyPrompt();

    // ── Pass 2: structured narrative memory (point-in-time, strictly before this section) ──
    // Supplements (never replaces) the linear manuscript context. Any failure here is
    // non-fatal: the section is written exactly as before.
    let narratorCtx: NarratorContext | null = null;
    if (engine === "adaptive" && book.id) {
      try {
        const owned = await verifyBookOwnership(adminSupabase, book.id, auth.user.id);
        if (!owned) throw new Error("not owner");
        const [rows, idRes] = await Promise.all([
          loadNarrativeRows(adminSupabase, book.id),
          adminSupabase.from("identity_entities").select("id, kind, name, aliases, introduced_position").eq("book_id", book.id).limit(2000),
        ]);
        const objective = [subsection.title, subsection.description ?? subsection.summary].filter(Boolean).join(": ") || chapter.title || "Continue the book";
        const adaptiveInput = { bookType: book.bookType, position: { chapterIndex: absChapter, subsectionIndex }, objective, outline: owned.outline, rows, identityEntities: idRes.data ?? [] };
        let context, candidateCount: number;
        if (progressive) {
          // Phase 3: narrator knowledge filtered by scene chronology + vantage (books with a narrator identity only).
          try { narratorCtx = await loadNarratorContext(adminSupabase, book.id, auth.user.id, { chapterIndex: absChapter, subsectionIndex }, progressive.plan?.usable ? progressive.plan.section : null); }
          catch (e) { console.warn("[phase-3] narrator context skipped:", e instanceof Error ? e.message : e); narratorCtx = null; }
          const pr = buildPlanningAwareContext({ ...adaptiveInput, master: progressive.master, readyPlans: progressive.readyPlans, anchors: progressive.anchorRows, extraCandidates: narratorCtx?.candidates });
          context = pr.context; candidateCount = pr.metrics.candidates;
          Object.assign(runMetrics, { plan_mode: pr.mode, plan_fallback: pr.fallbackReason ?? null, spoiler_blocked: pr.metrics.spoilerBlocked });
        } else {
          ({ context, candidateCount } = buildAdaptiveContext(adaptiveInput));
        }
        userPrompt = userPrompt.replace(/\n\n/, () => `\n\n${context.text}\n\n`);
        const omittedCounts: Record<string, number> = {};
        for (const o of context.omitted) omittedCounts[o.reason] = (omittedCounts[o.reason] ?? 0) + 1;
        Object.assign(runMetrics, { profile_id: context.profileId, context_words: context.wordCount, candidates: candidateCount, included: context.included.length, omitted: omittedCounts });
        console.log(`[context-engine] adaptive profile=${context.profileId} words=${context.wordCount} included=${context.included.length}/${candidateCount}`);
      } catch (e) {
        // Fail open: write exactly as legacy would with the client-sent window.
        console.warn("[context-engine] adaptive failed, falling back:", e instanceof Error ? e.message : e);
        runMetrics.fell_back = true;
        runMetrics.error = e instanceof Error ? e.message.slice(0, 300) : String(e);
        userPrompt = legacyPrompt();
      }
    }
    if ((engine === "legacy" || runMetrics.fell_back) && book.id) {
      try {
        const owned = await verifyBookOwnership(adminSupabase, book.id, auth.user.id);
        if (owned) {
          const rows = await loadNarrativeRows(adminSupabase, book.id);
          const narrativeBlock = buildNarrativeContext(rows, { chapterIndex: absChapter, subsectionIndex }, owned.outline?.characters ?? [], owned.outline?.chapters ?? []);
          if (narrativeBlock) {
            userPrompt = userPrompt.replace(/\n\n/, () => `\n\n${narrativeBlock}\n\n`);
            console.log(`[narrative-context] injected chars=${narrativeBlock.length}`);
          }
        }
      } catch (e) {
        console.warn("[narrative-context] skipped:", e instanceof Error ? e.message : e);
      }
    }

    // ── Phase F, Standard mode: keep the manuscript window, add the writer-safe plan + exact details. ──
    if (progressive && (engine === "legacy" || runMetrics.fell_back) && progressive.plan.usable) {
      userPrompt = `${userPrompt}\n\n${renderPlanBlock(progressive.plan, absChapter, progressive.anchors, progressive.required)}`;
      runMetrics.plan_mode = "planned";
    } else if (progressive && !progressive.plan.usable) {
      runMetrics.plan_mode = "legacy"; runMetrics.plan_fallback = progressive.plan.reason;
    }

    // ── Style Diversity: planned opening strategy — Progressive Planning only (Standard prompts unchanged) ──
    if (progressive && progressive.plan.usable) try {
      const ledger = buildLedger(book.outline, { chapterIndex, subsectionIndex });
      const strategy = planOpeningStrategy({ bookType: book.bookType, writerId: book.controls?.writerId ?? null, position: ledger.length, ledger });
      userPrompt = `${userPrompt}\n\n${renderOpeningStrategyBlock(strategy, ledger)}`;
      console.log(`[rhetoric] strategy=${strategy} prior=${ledger.length}`);
    } catch (e) { console.warn("[rhetoric] skipped:", e instanceof Error ? e.message : e); }

    // ── Stage D: author-approved, pinned writer overlays — dynamic tail only, analyze_and_rewrite only ──
    if (progressive && progressive.plan.usable && book.id && resolveNaturalnessMode(book.controls) === "analyze_and_rewrite") try {
      const writerId = resolveWriter(book.controls, book.bookType).id;
      const pins = Array.isArray(book.controls?.adaptationPins) ? (book.controls.adaptationPins as string[]) : null;
      const { data: ov } = await adminSupabase.from("writer_style_adaptations").select("id, writer_id, dimension, adjustment, status, version, expires_at").eq("user_id", auth.user.id).eq("writer_id", writerId).eq("status", "active").limit(50);
      const block = renderActiveOverlays(ov ?? [], writerId, pins);
      if (block) userPrompt = `${userPrompt}\n\n${block}`;
    } catch (e) { console.warn("[learning] overlays skipped:", e instanceof Error ? e.message : e); }



    // Paragraph memory is read from completed extraction records and checked against current saved prose.
    if (book.id && serverOutline?.chapters) {
      const { data: memories, error: memoryError } = await adminSupabase.from('narrative_extractions')
        .select('chapter_index,subsection_index,content_hash,status,applied').eq('book_id', book.id).eq('user_id', auth.user.id).eq('status', 'completed');
      if (memoryError) throw new Error('Could not load accepted paragraph memory');
      const memoryBlock = renderWholeBookMemory(memories ?? [], serverOutline.chapters, { chapterIndex: absChapter, subsectionIndex }, contentHash);
      if (memoryBlock) userPrompt += `\n\n${memoryBlock}`;
    }

    if (dryRun) {
      // Routing is resolved, never called, in a dry run.
      const routing = progressive ? (() => { return loadBookModelConfig(adminSupabase, book.id, auth.user.id).then((cfg) => {
        const r = (role: any) => { try { const m = resolveModelForRole(cfg, role); return { model: m.model, source: m.source, fallback: m.fallback ?? null }; } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; } };
        return { mode: cfg.mode, writer: r("writer"), continuity_checker: r("continuity_checker"), continuity_reviser: r("continuity_reviser"), narrative_extractor: r("narrative_extractor"), planner: r("planner") };
      }); })() : null;
      return new Response(JSON.stringify({ dryRun: true, absChapter, subsectionIndex, engine, runMetrics, pipeline,
        progressive: progressive ? { gate: progressive.gate, planRequirement: requireApprovedPlan(progressive.plan), planUsable: progressive.plan.usable, planReason: progressive.plan.usable ? null : progressive.plan.reason, requiredAnchors: progressive.required, anchorsInScope: progressive.anchors.length, routing: await routing } : null, previousNovelTextChars: previousNovelText?.length ?? 0, systemPromptChars: systemPrompt.length, userPrompt }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Pass 3: provider-neutral AI call (role = writer) ──
    const bookModelConfig = await loadBookModelConfig(adminSupabase, book.id, auth.user.id);
    // Freeze the Book Voice Manifest on first generation (never overwritten).
    try {
      const { data: vb } = await adminSupabase.from("books").select("book_type, tone_profile, controls, voice_manifest").eq("id", book.id).eq("user_id", auth.user.id).maybeSingle();
      if (vb && !vb.voice_manifest) await adminSupabase.from("books").update({ voice_manifest: buildVoiceManifest(vb, bookModelConfig) }).eq("id", book.id).eq("user_id", auth.user.id).is("voice_manifest", null);
    } catch (e) { console.warn("[voice-manifest]", e instanceof Error ? e.message : e); }
    // Writing speed: "fast" (default) swaps long-thinking prose models for their quick
    // counterparts and lowers reasoning effort; "studio" keeps the full deep-writing path.
    const writingSpeed = (book.controls as Record<string, unknown> | null)?.writingSpeed === "studio" ? "studio" : "fast";
    const normalWriter = resolveModelForRole(bookModelConfig, "writer", { bookType: book.bookType });
    const fastWriter = resolveModelForRole(bookModelConfig, "writer", { fast: writingSpeed === "fast", bookType: book.bookType });
    const modelOverride = (bookModelConfig.mode === "legacy" && typeof reqAiModel === "string" ? LEGACY_PICKER_MAP[reqAiModel] ?? null : null)
      ?? (fastWriter.model !== resolveModelForRole(bookModelConfig, "writer").model ? fastWriter.model : null);
    const aiMeta: Record<string, unknown> = {};
    const chunks = streamAI({
      role: "writer",
      config: bookModelConfig,
      userId: auth.user.id,
      bookId: book.id ?? null,
      modelOverride,
      request: { system: systemPrompt, user: userPrompt, reasoning: writingSpeed === "fast" ? "low" : "medium" },
    }, createAIDeps(adminSupabase, auth.user.id), aiMeta);

    // The first chunk can take minutes on reasoning models; the response opens immediately and
    // keepalive comments flow until it arrives (provider errors arrive as an SSE error event).

    // ── Helper: append generated text to book.full_text and invalidate cache ──
    const finalizeFullText = async (newContent: string) => {
      if (!isNarrative || isChildrensBook || !book.id) return;
      try {
        const { data: row } = await adminSupabase
          .from("books")
          .select("full_text, total_char_count, user_id")
          .eq("id", book.id)
          .maybeSingle();
        if (!row || row.user_id !== auth.user.id) return;
        const updated = ((row.full_text || "") + (row.full_text ? "\n\n" : "") + newContent).slice(-500_000); // safety cap 500k
        const newCharCount = updated.length;
        await adminSupabase
          .from("books")
          .update({ full_text: updated, total_char_count: newCharCount })
          .eq("id", book.id);
        // Old hash-keyed entries become unreachable; drop this book's entries to free memory.
        for (const k of NOVEL_TEXT_CACHE.keys()) if (k.includes(`_${book.id}_`)) NOVEL_TEXT_CACHE.delete(k);
        console.log(`[novel-cache] invalidated book entries, new chars=${newCharCount}`);
      } catch (e) {
        console.warn("[novel-cache] full_text update failed:", e);
      }
    };

    // ── Strip leftover meta-labels the model may emit ──
    const stripMetaLabels = (s: string) =>
      s
        .replace(/^\s*(?:Hook|Teaser|Scene|Beat|Note)\s*:\s*/gim, "")
        .replace(/\[\/?(?:HOOK|TEASER|SCENE|BEAT|NOTE)\]/gi, "");

    async function* all(): AsyncGenerator<string> {
      let firstSeen = false;
      for await (const c of chunks) {
        if (!firstSeen) { firstSeen = true; console.log(`[generate-content] model=${aiMeta.model} via=${aiMeta.provider} source=${aiMeta.credentialSource} fallback=${aiMeta.usedFallback}`); }
        // A worker that lost its lease stops writing immediately; nothing it produced is saved.
        if (heartbeat?.lost()) throw new Error("STALE_GENERATION_LEASE_REJECTED: this section is now being written elsewhere");
        yield c;
      }
    }
    const stream = toChatSSE(all(), async (full) => {
      const u = aiMeta.usage as { cachedInputTokens?: number | null; inputTokens?: number | null } | undefined;
      if (u) console.log(`[cache] cached=${u.cachedInputTokens ?? "unknown"} input=${u.inputTokens ?? "unknown"}`);
      const cleaned = stripMetaLabels(full).trim();
      if (cleaned && lease && book.id) {
        // Last renewal just before the write; a lost worker never attempts the commit.
        const alive = heartbeat ? await heartbeat.beat() : true;
        if (!alive) { heartbeat?.stop(); runMetrics.error = "commit: lease lost before save"; console.warn("[phase-f] commit skipped: lease lost"); }
        else {
        // Phase G: all five validation stages run BEFORE acceptance (Stage 1 free + one combined
        // evaluator call, ≤2 targeted repairs, full revalidation). Material findings hold the draft as a
        // recoverable candidate; the previously accepted manuscript stays exactly as it was.
        let finalText = cleaned;
        let decision: "accept" | "blocked_material" | "needs_author_review" = "accept";
        let provenCategories: string[] = []; // Stage D: categories a rewrite demonstrably improved
        try {
          const { data: factRows } = await adminSupabase.from("canonical_facts").select("id, subject, predicate, value, is_canonical, conflict_status, canon_status, source_chapter_index, source_subsection_index").eq("book_id", book.id).eq("canon_status", "ESTABLISHED").limit(400);
          const beatNotes = (progressive?.readyPlans ?? []).filter((r: any) => r.subsection_index === subsectionIndex).flatMap((r: any) => Array.isArray(r.content?.notes) ? r.content.notes : []);
          const ctx = buildEvalContext({ bookType: book.bookType, plan: progressive!.plan, chapterIndex: absChapter, anchors: progressive!.anchors as never, facts: factRows ?? [], controls: book.controls, beatNotes });
          if (isChildrensBook) ctx.adapter = "childrens";
          if (!narratorCtx) { try { narratorCtx = await loadNarratorContext(adminSupabase, book.id, auth.user.id, { chapterIndex: absChapter, subsectionIndex }, progressive?.plan?.usable ? progressive.plan.section : null); } catch { narratorCtx = null; } }
          if (narratorCtx) Object.assign(ctx, { narration: narratorCtx.narration, lifeRecords: narratorCtx.lifeRecords, sceneDate: narratorCtx.sceneDate });
          const cfg = await loadBookModelConfig(adminSupabase, book.id, auth.user.id);
          const { evaluate, repair } = modelCallers(cfg, auth.user.id, book.id, createAIDeps(adminSupabase, auth.user.id));
          const warnRatio = Number((book.controls as Record<string, unknown> | null)?.revisionWarnRatio) || undefined;
          // Stage C: optional targeted naturalness rewrite of the UNACCEPTED draft ("analyze_and_rewrite" only).
          // The result still goes through the full validation + fenced acceptance below.
          let draftForValidation = cleaned;
          if (resolveNaturalnessMode(book.controls) === "analyze_and_rewrite") {
            try {
              const nr = await runNaturalnessRewrite(cleaned, { mode: "analyze_and_rewrite", protectedMotifs: await loadProtectedMotifs(adminSupabase, book.id), ledger: buildLedger(book.outline, { chapterIndex, subsectionIndex }), bookType: book.bookType, controls: book.controls, changeLimit: warnRatio }, repair);
              draftForValidation = nr.text;
              if (nr.changed) { const after = new Set(nr.after.map((f) => f.category)); provenCategories = [...new Set(nr.before.map((f) => f.category))].filter((c) => !after.has(c)); }
              console.log("[naturalness] rewrite", JSON.stringify({ changed: nr.changed, attempts: nr.attempts }));
            } catch (e) { console.warn("[naturalness] rewrite skipped:", e instanceof Error ? e.message : e); }
          }
          // Tier 2 literary reviser: only when the author opted into "automatic". Exact model, own key,
          // per-section cost ceiling; the 20% limit is measured against the ORIGINAL draft. The result is
          // never accepted here — it goes through the same full validation + fenced acceptance below.
          const lit = resolveLiteraryReviser(book.controls, cfg);
          if (lit.mode === "automatic") {
            try {
              const budget = new LiteraryBudget(lit.capUsd);
              const lr = await runNaturalnessRewrite(draftForValidation, { mode: "analyze_and_rewrite", protectedMotifs: await loadProtectedMotifs(adminSupabase, book.id), bookType: book.bookType, controls: book.controls, changeLimit: warnRatio, promptBuilder: buildLiteraryPrompt, maxAttempts: lit.maxAttempts }, literaryCaller(lit, { userId: auth.user.id, bookId: book.id, deps: createAIDeps(adminSupabase, auth.user.id), budget }));
              const { changeRatio } = await import("../_shared/writers/textDiff.ts");
              if (lr.changed && changeRatio(cleaned, lr.text) <= (warnRatio ?? 0.2)) draftForValidation = lr.text;
              console.log("[literary] rewrite", JSON.stringify({ model: lit.model, changed: lr.changed, attempts: lr.attempts, spentCeiling: budget.spent }));
            } catch (e) { console.warn("[literary] rewrite skipped:", e instanceof Error ? e.message : e); }
          }
          const r = await runPreAcceptance(draftForValidation, ctx, evaluate, repair, { warnRatio });
          finalText = r.text; decision = r.decision;
          Object.assign(runMetrics, { validation_status: r.decision, validation_rounds: r.rounds, validation_input_tokens: r.usage.inputTokens, validation_output_tokens: r.usage.outputTokens, validation_cost_usd: r.usage.costUsd });
          await persistOutcome(r, { db: adminSupabase, bookId: book.id, userId: auth.user.id, chapter: absChapter, sub: subsectionIndex, hash: contentHash(finalText),
            masterPlanId: progressive?.plan.usable ? progressive.master?.id ?? null : null, origin: "generated" });
        } catch (e) {
          // Critical checks are never skipped: if validation itself fails, the draft is not accepted.
          decision = "needs_author_review";
          console.warn("[phase-g] validation step failed:", e instanceof Error ? e.message : e);
          await adminSupabase.rpc("save_candidate_draft", { p_book_id: book.id, p_user_id: auth.user.id, p_chapter: absChapter, p_sub: subsectionIndex,
            p_master_plan_id: progressive?.master?.id ?? null, p_text: cleaned, p_hash: contentHash(cleaned), p_status: "NEEDS_AUTHOR_REVIEW",
            p_findings: [{ code: "VALIDATION_FAILED", stage: 3, severity: "moderate", message: "Checks could not complete; retry validation before accepting." }], p_usage: {}, p_origin: "generated", p_parent: null, p_dedup_keys: [] }).then(() => {}, () => {});
        }
        const stillAlive = heartbeat ? await heartbeat.beat() : true;
        heartbeat?.stop();
        if (decision !== "accept" || !stillAlive) {
          runMetrics.error = !stillAlive ? "commit: lease lost during validation" : `phase-g: draft held for author (${decision})`;
          await adminSupabase.rpc("release_generation_lease", { p_lease_id: lease.lease_id, p_worker: lease.worker, p_token: lease.fencing_token }).then(() => {}, () => {});
        } else {
        const hash = contentHash(finalText);
        // Fence check + manuscript write + acceptance record + lease release: one transaction.
        const { data: c, error: ce } = await adminSupabase.rpc("commit_fenced_section", {
          p_book_id: book.id, p_user_id: auth.user.id, p_chapter: absChapter, p_sub: subsectionIndex, p_worker: lease.worker, p_token: lease.fencing_token,
          p_text: finalText, p_hash: hash, p_master_plan_id: progressive?.plan.usable ? progressive.master?.id ?? null : null, p_replace: body.replaceAccepted === true,
        });
        if (ce) { console.warn("[phase-f] commit rejected:", ce.message); runMetrics.error = `commit: ${ce.message.slice(0, 200)}`; }
        else {
          for (const k of NOVEL_TEXT_CACHE.keys()) if (k.includes(`_${book.id}_`)) NOVEL_TEXT_CACHE.delete(k);
          console.log("[phase-f] commit", JSON.stringify(c));
          // Replacing an accepted section flags derived/later memory inside commit_fenced_section itself.
          await adminSupabase.rpc("write_accepted_outline_text", { p_book_id: book.id, p_user_id: auth.user.id, p_chapter: absChapter, p_sub: subsectionIndex, p_text: finalText, p_hash: hash }).then(() => {}, () => {});
          // Stage B: advisory-only naturalness analysis, off by default. Never blocks or rewrites.
          if (resolveNaturalnessMode((book as any).controls) !== "off") {
            try {
              const nl = buildLedger(book.outline, { chapterIndex, subsectionIndex });
              const fs = analyzeSection(finalText, { ledger: nl, bookType: book.bookType, protectedMotifs: await loadProtectedMotifs(adminSupabase, book.id) });
              await adminSupabase.from("naturalness_findings").delete().eq("book_id", book.id).eq("chapter_index", absChapter).eq("subsection_index", subsectionIndex).eq("status", "open");
              if (fs.length) await adminSupabase.from("naturalness_findings").insert(fs.map((f) => ({ book_id: book.id, user_id: auth.user.id, chapter_index: absChapter, subsection_index: subsectionIndex, category: f.category, severity: f.severity, message: f.message, evidence: f.evidence, content_hash: hash })));
              // Stage D: learning signals (best-effort; never blocks). Findings + proven rewrite improvements.
              const sig = { userId: auth.user.id, bookId: book.id, controls: book.controls, bookType: book.bookType, chapter: absChapter, sub: subsectionIndex, hash };
              await recordSignals(adminSupabase, { ...sig, categories: fs.map((f) => f.category), kind: "finding", sourceRef: `section:${book.id}:${absChapter}:${subsectionIndex}:${hash}` });
              await recordSignals(adminSupabase, { ...sig, categories: provenCategories, kind: "proven", sourceRef: `rewrite:${book.id}:${absChapter}:${subsectionIndex}:${hash}` });
            } catch (e) { console.warn("[naturalness] skipped:", e instanceof Error ? e.message : e); }
          }
        }
        }
        }
      } else if (cleaned && !progressive) await finalizeFullText(cleaned);
      if (lease && !cleaned) { heartbeat?.stop(); await adminSupabase.rpc("release_generation_lease", { p_lease_id: lease.lease_id, p_worker: lease.worker, p_token: lease.fencing_token }).then(() => {}, () => {}); }
      // Phase 2D measurement: one row per generated section, both engines. Never blocks the writer.
      if (book.id) {
        try {
          const usage = (aiMeta.usage ?? {}) as { inputTokens?: number | null; outputTokens?: number | null; cachedInputTokens?: number | null };
          let cost: number | null = null;
          try { cost = aiMeta.model ? estimateCostUSD(String(aiMeta.model), usage as never) : null; } catch { cost = null; }
          await adminSupabase.from("context_engine_runs").insert({
            ...runMetrics, book_id: book.id, user_id: auth.user.id, chapter_index: absChapter, subsection_index: subsectionIndex,
            book_type: book.bookType, prompt_words: (systemPrompt + userPrompt).split(/\s+/).length,
            model: aiMeta.model ?? null, input_tokens: usage.inputTokens ?? null, cached_input_tokens: usage.cachedInputTokens ?? null,
            output_tokens: usage.outputTokens ?? null, estimated_cost_usd: cost, latency_ms: Date.now() - startedAt,
            output_words: cleaned ? cleaned.split(/\s+/).length : 0,
          });
        } catch (e) { console.warn("[context-engine] metrics skipped:", e instanceof Error ? e.message : e); }
      }
    }, (e) => { heartbeat?.stop(); if (lease) adminSupabase.rpc("release_generation_lease", { p_lease_id: lease.lease_id, p_worker: lease.worker, p_token: lease.fencing_token }).then(() => {}, () => {}); console.error("[generate-content] stream error:", e instanceof Error ? e.message : e); });

    return new Response(withKeepalive(stream), { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (error) {
    console.error("generate-content error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/** Passes the stream through, emitting SSE comments while it is silent so the 150s idle limit never fires. */
function withKeepalive(inner: ReadableStream<Uint8Array>, everyMs = 15_000): ReadableStream<Uint8Array> {
  const ping = new TextEncoder().encode(": keepalive\n\n");
  const reader = inner.getReader();
  let timer: number | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(() => { try { controller.enqueue(ping); } catch { /* closed */ } }, everyMs);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) { clearInterval(timer); try { controller.close(); } catch { /* closed */ } return; }
      controller.enqueue(value);
    },
    cancel(reason) { clearInterval(timer); return reader.cancel(reason); },
  });
}
