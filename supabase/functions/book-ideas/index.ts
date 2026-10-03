// Book Ideas: OpenAI-only generator of complete book setups (title, description, type, genre, audience,
// writer, 15 sliders within the writer's baseline ±2, divergence). Suggestions only — writes nothing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { generateAIText, statusForAIError } from "../_shared/ai/client.ts";
import { AIProviderError } from "../_shared/ai/providers.ts";
import { createAIDeps } from "../_shared/ai/server.ts";
import { WRITER_PERSONAS, getWriter } from "../_shared/writers/personas.ts";
import { SLIDERS, boundAll, type SliderValues } from "../_shared/writers/sliders.ts";
import { WRITER_BASELINES } from "../_shared/writers/manifest.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const OPENAI_MODEL = "openai/gpt-6-astra";
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    if (parseInt(req.headers.get("content-length") || "0") > 60_000) return json({ error: "Payload too large" }, 413);
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error } = await anon.auth.getClaims(authHeader.slice(7));
    if (error || !claims?.claims) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub as string;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: ok } = await admin.rpc("check_rate_limit", { _user_id: userId, _function_name: "book-ideas", _max_per_hour: 10, _max_per_day: 40 });
    if (ok === false) return json({ error: "You've generated a lot of ideas — please wait a bit." }, 429);

    const body = await req.json().catch(() => null);
    const brief = str(body?.brief, 600);
    const count = Math.min(6, Math.max(2, Number(body?.count) || 4));
    // Catalog of allowed options comes from the app's own lists: { bookType: { audiences: [], genres: [] } }
    const catalog: Record<string, { audiences: string[]; genres: string[] }> = {};
    for (const [k, v] of Object.entries(body?.catalog ?? {}).slice(0, 60)) {
      const o = v as { audiences?: unknown; genres?: unknown };
      catalog[str(k, 40)] = { audiences: (Array.isArray(o?.audiences) ? o.audiences : []).map((x) => str(x, 40)).slice(0, 12), genres: (Array.isArray(o?.genres) ? o.genres : []).map((x) => str(x, 60)).slice(0, 20) };
    }
    if (!Object.keys(catalog).length) return json({ error: "Missing book options" }, 400);

    const writers = WRITER_PERSONAS.map((w) => `${w.id}: ${w.name} — ${w.tagline}; best for ${w.bookTypes.join(", ")}`).join("\n");
    const sliderList = SLIDERS.map((s) => `${s.key} (${s.low} → ${s.high})`).join(", ");
    const system = `You are a book development editor. Propose complete, distinct book setups. Reply with JSON only: {"ideas":[...]}.
Each idea: {"title","subtitle","description" (2–3 sentences, the book's theme/premise),"bookType","genre","audience","writerId","whyThisWriter" (1 sentence),"divergence" ("strict"|"controlled"|"open"),"sliders":{each of: ${SLIDERS.map((s) => s.key).join(", ")} as integers 1–10}}.
Allowed bookType values and, for each, allowed audience and genre values (use them exactly; genre may be "" if none listed):
${JSON.stringify(catalog)}
Writers (pick the best fit by id):
${writers}
Slider meanings: ${sliderList}.
No markdown. Never use the words "magic" or "magical".`;
    const user = `Give ${count} book ideas.${brief ? ` Author's direction: ${brief}` : " Vary book types and audiences."}`;

    try {
      const r = await generateAIText({ role: "planner", config: { mode: "single", singleModel: OPENAI_MODEL }, userId, bookId: null, request: { system, user, json: true, reasoning: "low" } }, createAIDeps(admin, userId));
      let parsed: any;
      try { parsed = JSON.parse(r.text.replace(/^```(json)?|```$/g, "").trim()); } catch { return json({ error: "The idea generator returned an unreadable answer — please try again." }, 502); }
      const ideas = (Array.isArray(parsed?.ideas) ? parsed.ideas : []).slice(0, count).flatMap((i: any) => {
        const bookType = str(i?.bookType, 40);
        const opts = catalog[bookType];
        if (!opts) return [];
        const writer = getWriter(i?.writerId) ?? WRITER_PERSONAS.find((w) => w.bookTypes.includes(bookType)) ?? WRITER_PERSONAS[0];
        const base = WRITER_BASELINES[writer.id];
        const requested: Partial<SliderValues> = {};
        for (const s of SLIDERS) { const v = i?.sliders?.[s.key]; if (typeof v === "number" && Number.isFinite(v)) requested[s.key] = v; }
        const audience = opts.audiences.includes(i?.audience) ? i.audience : opts.audiences[0] ?? "general-readers";
        const genre = opts.genres.includes(i?.genre) ? i.genre : (opts.genres[0] ?? "");
        return [{
          title: str(i?.title, 120) || "Untitled", subtitle: str(i?.subtitle, 160), description: str(i?.description, 800),
          bookType, genre, audience, writerId: writer.id, whyThisWriter: str(i?.whyThisWriter, 300),
          divergence: ["strict", "controlled", "open"].includes(i?.divergence) ? i.divergence : "strict",
          sliders: base ? boundAll(base, requested) : null,
        }];
      });
      if (!ideas.length) return json({ error: "No usable ideas came back — please try again." }, 502);
      return json({ ideas, model: r.meta.model });
    } catch (e) {
      if (e instanceof AIProviderError) return json({ error: e.message }, statusForAIError(e));
      throw e;
    }
  } catch (e) {
    console.error("book-ideas error:", e);
    return json({ error: "Something went wrong" }, 500);
  }
});
