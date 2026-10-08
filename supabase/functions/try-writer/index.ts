// Try Writer: a short, non-destructive sample from a writer × tier profile with the 15 expression sliders.
// Never touches books, voice manifests or story memory.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { generateAIText, statusForAIError } from "../_shared/ai/client.ts";
import { AIProviderError } from "../_shared/ai/providers.ts";
import { createAIDeps } from "../_shared/ai/server.ts";
import { getWriter, renderWriterPrompt } from "../_shared/writers/personas.ts";
import { openingDirective } from "../_shared/writers/opening.ts";
import { planOpeningStrategy, renderOpeningStrategyBlock } from "../_shared/writers/rhetoric.ts";
import { isTier, getProfile } from "../_shared/writers/profiles.ts";
import { SLIDERS, NEUTRAL, boundAll, renderExpressionBlock, resolveDivergence, type SliderValues } from "../_shared/writers/sliders.ts";
import { WRITER_BASELINES } from "../_shared/writers/manifest.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    if (parseInt(req.headers.get("content-length") || "0") > 20_000) return json({ error: "Payload too large" }, 413);
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error } = await anon.auth.getClaims(authHeader.slice(7));
    if (error || !claims?.claims) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub as string;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: ok } = await admin.rpc("check_rate_limit", { _user_id: userId, _function_name: "try-writer", _max_per_hour: 15, _max_per_day: 60 });
    if (ok === false) return json({ error: "You've tried a lot of samples — please wait a bit." }, 429);

    const body = await req.json().catch(() => null);
    const writer = getWriter(body?.writerId);
    if (!writer) return json({ error: "Unknown writer" }, 400);
    if (!isTier(body?.tier) || !getProfile(writer.id, body.tier)) return json({ error: "Unknown tier" }, 400);
    const bookType = typeof body?.bookType === "string" && body.bookType.length < 40 ? body.bookType : writer.bookTypes[0];
    const premise = typeof body?.premise === "string" ? body.premise.trim().slice(0, 600) : "";
    if (!premise) return json({ error: "Write a short premise first" }, 400);

    const requested: Partial<SliderValues> = {};
    for (const s of SLIDERS) { const v = body?.sliders?.[s.key]; if (typeof v === "number" && Number.isFinite(v)) requested[s.key] = v; }
    const base = WRITER_BASELINES[writer.id];
    // With a baseline: ±2 bound. Until baselines arrive: free 1–10 (boundAll on a neutral copy would wrongly cap at 3–7).
    const effective: SliderValues = base ? boundAll(base, requested) : { ...NEUTRAL, ...Object.fromEntries(Object.entries(requested).map(([k, v]) => [k, Math.min(10, Math.max(1, Math.round(v as number)))])) };

    const system = `${renderWriterPrompt(writer, bookType)}\n\n${renderExpressionBlock(effective, resolveDivergence({ divergenceMode: body?.divergence }))}\n\n${openingDirective(bookType)}\n\nWrite plain prose only — no markdown, no headings, no labels. Never use the words "magic" or "magical".`;
    const strategy = planOpeningStrategy({ bookType, writerId: writer.id, position: Math.floor(Date.now() / 1000) });
    const user = `This is a short preview so the author can hear your voice. Write the opening of a ${bookType} piece (about 200–250 words) based on this premise:\n\n${premise}\n\n${renderOpeningStrategyBlock(strategy)}`;

    try {
      const r = await generateAIText({ role: "writer", config: { mode: "profile", profileWriter: writer.id, profileTier: body.tier }, userId, bookId: null, request: { system, user, temperature: 0.8 } }, createAIDeps(admin, userId));
      return json({ text: r.text.trim(), model: r.meta.model, opening_strategy: strategy, baseline_slider_values: base ?? null, effective_slider_values: effective });
    } catch (e) {
      if (e instanceof AIProviderError) return json({ error: e.message }, statusForAIError(e));
      throw e;
    }
  } catch (e) {
    console.error("try-writer error:", e);
    return json({ error: "Something went wrong" }, 500);
  }
});
