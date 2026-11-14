// Dynamic AI page composition. The model only CHOOSES among validated catalog options;
// the shared deterministic builder computes geometry. Invalid answers are rejected (422),
// so the client discloses its deterministic fallback instead of labelling it AI.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { generateAIText, statusForAIError } from "../_shared/ai/client.ts";
import { AIProviderError } from "../_shared/ai/providers.ts";
import { createAIDeps } from "../_shared/ai/server.ts";
import { STYLE_FAMILY_DEFS, compatibleLayouts, getLayout, asDesignBookType, STYLE_FAMILIES, validateChoice } from "../_shared/pageDesign/index.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const MODEL = "openai/gpt-6-sol";
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    if (parseInt(req.headers.get("content-length") || "0") > 60_000) return json({ error: "Payload too large" }, 413);
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ") || !req.headers.get("apikey")) return json({ error: "Unauthorized" }, 401);
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error } = await anon.auth.getClaims(authHeader.slice(7));
    if (error || !claims?.claims) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub as string;
    const body = await req.json().catch(() => null);
    if (body?.action === "version") return json({ version: 1, model: MODEL });

    const bookId = str(body?.bookId, 64);
    const { data: book } = await anon.from("books").select("id, book_type, user_id").eq("id", bookId).maybeSingle();
    if (!book || book.user_id !== userId) return json({ error: "Book not found" }, 404);
    const bookType = asDesignBookType(book.book_type);
    if (!bookType) return json({ error: "This book type has no page design" }, 400);
    const styleFamily = STYLE_FAMILIES.includes(body?.styleFamily) ? body.styleFamily : null;
    if (!styleFamily) return json({ error: "Invalid style family" }, 400);
    const imageCount = Math.max(0, Math.min(6, Number(body?.imageCount) | 0));
    const candidates = compatibleLayouts(bookType, imageCount).map((l) => l.id);
    if (!candidates.length) return json({ error: "No compatible layouts" }, 422);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: ok } = await admin.rpc("check_rate_limit", { _user_id: userId, _function_name: "compose-page", _max_per_hour: 120, _max_per_day: 600 });
    if (ok === false) return json({ error: "Too many page compositions — please wait a bit." }, 429);

    const fam = STYLE_FAMILY_DEFS[styleFamily as keyof typeof STYLE_FAMILY_DEFS];
    const layouts = candidates.map((id) => { const d = getLayout(id)!; return `${id} [${d.category}, ${d.slots.length} image(s)]: ${d.description}`; }).join("\n");
    const system = `You are an art director composing ONE ${bookType} book page. Choose only from the lists given. Reply with JSON only:
{"layout": one candidate id, "shapes": [one shape per image slot of that layout], "treatments": [one per slot], "flow"?: text flow, "position"?: text position, "dropCap": boolean, "decorations": [{"kind","position","density":1|2|3}] (0–2), "accentFamily"?: one of ${JSON.stringify(fam.compatible)}, "rationale": one sentence}.
Candidates:\n${layouts}
Allowed shapes: ${JSON.stringify(fam.shapes)}. Allowed treatments: ${JSON.stringify([...fam.treatments, "bleed"])} (use "bleed" only for slots that bleed). Decorations: ${JSON.stringify(fam.decorations)}; positions top|bottom|corners|border|background.
Text flows: wrap-left, wrap-right, wrap-around-circle, wrap-around-organic, wrap-top-bottom, over-negative-space, multi-column, block.
Rules: match emotional intensity and pacing; keep the book's visual rhythm (avoid repeating the categories of the recent layouts); never place text over an image subject's focal zone; prefer layouts whose text area fits the word count; children's pages favour big art and few words per page.`;
    const features = body?.features ?? {};
    const user = JSON.stringify({
      words: Number(features.words) || 0, paragraphs: Number(features.paragraphs) || 0, dialogueRatio: Number(features.dialogueRatio) || 0,
      pacingHeuristic: str(features.pacing, 20), imageFocalZones: Array.isArray(features.focal) ? features.focal.slice(0, 6) : [],
      recentLayouts: (Array.isArray(body?.recentLayouts) ? body.recentLayouts : []).slice(-4).map((x: unknown) => str(x, 40)),
      heading: str(body?.heading, 200), excerpt: str(body?.excerpt, 2400),
      task: "Read the excerpt for emotion and pacing, then choose.",
    });

    let r;
    try { r = await generateAIText({ role: "planner", config: { mode: "single", singleModel: MODEL }, userId, bookId, request: { system, user, json: true, reasoning: "low" } }, createAIDeps(admin, userId)); }
    catch (e) { if (e instanceof AIProviderError) return json({ error: e.message, code: "AI_UNAVAILABLE" }, statusForAIError(e)); throw e; }
    let parsed: unknown;
    try { parsed = JSON.parse(r.text.replace(/^```(json)?|```$/g, "").trim()); } catch { return json({ error: "AI returned unreadable JSON", code: "AI_INVALID" }, 422); }
    const v = validateChoice(parsed, { candidates, styleFamily, accentFamily: body?.accentFamily });
    if (!v.ok) return json({ error: "AI composition failed validation", code: "AI_INVALID", details: v.errors.slice(0, 8) }, 422);
    return json({ choice: v.value, model: r.meta.model });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
