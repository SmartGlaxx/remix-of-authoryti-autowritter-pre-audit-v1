// Owner-only controlled naturalness A/B experiment ($0.10 hard cap, see _shared/writers/abExperiment.ts).
// Writes NO book data: no manuscript, candidate, acceptance or story memory. Only the normal
// ai_usage_records accounting rows are written. Exact models, no fallbacks, no retries.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { createAIDeps } from "../_shared/ai/server.ts";
import { generateAIText } from "../_shared/ai/client.ts";
import { runExperiment, countTokens, EXPERIMENT_MODELS, type ExpCaller } from "../_shared/writers/abExperiment.ts";
import type { Role } from "../_shared/ai/registry.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const ROLE_FOR: Record<string, Role> = { [EXPERIMENT_MODELS.writer]: "writer", [EXPERIMENT_MODELS.rewriter]: "editor", [EXPERIMENT_MODELS.validator]: "continuity_checker" };

const SOPHIA = "Sophia Laurent: reflective, emotionally resonant, character-focused interiority; precise sensory detail; restrained, never melodramatic.";
const WRITER_PROMPT = {
  system: `You are a literary fiction writer. Voice: ${SOPHIA} Write plain prose only: no markdown, no headings, no title. Separate paragraphs with a blank line. Write 8 to 10 paragraphs, about 800 words.`,
  user: "Scene: Mara Ellison, 34, returns to her late father's lakeside house in late October to sort his belongings before the sale. Her younger brother Theo, 29, arrives unexpectedly in the evening; they have not spoken in three years. Goal: Mara wants to finish quickly and leave. Conflict: Theo found their father's unsent letter addressed to Mara and wants to read it together. Outcome: Mara agrees to keep the letter unopened until morning. Include a little dialogue.",
};
const validatorPrompt = (text: string) => ({
  system: "You are a continuity checker. Facts that must hold: Mara Ellison is 34; Theo is 29; it is late October at their late father's lakeside house; they have not spoken in three years; the letter stays unopened until morning. Reply in at most 120 words: PASS or FAIL, then list any contradiction or new invented fact.",
  user: text,
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: c } = await user.auth.getClaims(auth.slice(7));
  const uid = c?.claims?.sub as string | undefined;
  if (!uid) return json({ error: "Unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== "RUN_PAID_EXPERIMENT_0.10") return json({ error: "confirmation required" }, 400);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const deps = createAIDeps(admin, uid);
  const routes: { model: string; credentialSource: string; usedFallback: boolean }[] = [];

  const caller: ExpCaller = async ({ model, system, user: u, maxOutputTokens }) => {
    const { text, meta } = await generateAIText({
      role: ROLE_FOR[model], userId: uid, bookId: null, maxRetries: 0,
      config: { mode: "single", singleModel: model, fallbacks: {} }, // exact model, no fallback
      request: { system, user: u, maxOutputTokens },
    }, deps);
    routes.push({ model: meta.model, credentialSource: meta.credentialSource, usedFallback: meta.usedFallback });
    return {
      text, modelUsed: meta.usedFallback ? `fallback:${meta.model}` : meta.model,
      // Unreported usage is charged at the worst case, never assumed free.
      inputTokens: meta.usage.inputTokens ?? countTokens(system) + countTokens(u),
      outputTokens: meta.usage.outputTokens ?? maxOutputTokens,
      cachedInputTokens: meta.usage.cachedInputTokens ?? 0,
    };
  };

  const report = await runExperiment({ writerPrompt: WRITER_PROMPT, validatorPrompt, writerVoice: SOPHIA }, caller);
  return json({ ...report, routes });
});
