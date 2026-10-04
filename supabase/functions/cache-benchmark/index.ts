// TEMPORARY Step-1 benchmark: proves Anthropic explicit prompt caching works and measures real savings.
// Runs a 4-call matrix with the CALLER's own Anthropic key (decrypted server-side, never returned).
// Delete this function after the scorecard is reviewed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { anthropicAdapter, type Usage } from "../_shared/ai/providers.ts";
import { requireModel } from "../_shared/ai/registry.ts";
import { getWriter, renderWriterPrompt } from "../_shared/writers/personas.ts";
import { WRITER_BASELINES } from "../_shared/writers/manifest.ts";
import { renderExpressionBlock } from "../_shared/writers/sliders.ts";
import { decryptKey } from "../_shared/ai/keyCrypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Static prefix: writer persona + expression calibration + fixed rules. Padded past the 1,024-token
 *  cache minimum with a deterministic style coda (~4,500 chars ≈ 1,150+ tokens). */
function buildStaticPrefix(): string {
  const sophia = getWriter("sophia")!;
  const base = [
    renderWriterPrompt(sophia, "fiction"),
    renderExpressionBlock(WRITER_BASELINES["sophia"]!, "strict"),
    "STATIC RULES: No markdown in prose. Never use the words \"magic\" or \"magical\". Maintain tonal consistency with the established style anchors.",
  ].join("\n\n");
  const coda = "STYLE CODA: Every scene advances character or plot. Vary sentence length. Ground emotion in physical detail. Avoid rumination; one interior beat per page maximum. End sections on a hook. ";
  let prefix = base;
  while (prefix.length < 5200) prefix += "\n" + coda;
  return prefix;
}

async function call(apiKey: string, system: string, user: string): Promise<Usage> {
  const model = requireModel("anthropic/claude-sonnet-5");
  const usage: Usage = { inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheWriteInputTokens: null, requestId: null };
  const gen = anthropicAdapter.stream(
    { system, user, maxOutputTokens: 32 },
    { model, apiKey, fetch },
  );
  for await (const ev of gen) {
    if (ev.type === "usage") for (const [k, v] of Object.entries(ev.usage)) if (v != null) (usage as any)[k] = v;
  }
  return usage;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error: claimsErr } = await anon.auth.getClaims(authHeader.slice(7));
    const userId = claims?.claims?.sub as string | undefined;
    if (claimsErr || !userId) return json({ error: "Unauthorized" }, 401);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: keyRow } = await db.from("user_provider_keys").select("ciphertext, iv").eq("user_id", userId).eq("provider", "anthropic").maybeSingle();
    if (!keyRow) return json({ error: "No Anthropic key saved. Add one in Settings → API Keys." }, 424);
    const apiKey = await decryptKey(Deno.env.get("BYOK_ENCRYPTION_KEY") ?? "", userId, keyRow.ciphertext, keyRow.iv);

    const P = buildStaticPrefix();
    const results: Record<string, unknown> = { prefixChars: P.length, model: "claude-sonnet-5", tests: [] as unknown[] };
    const t = results.tests as unknown[];

    // T1a: cold write — same writer, book A, first call. Expect cache_creation > 0.
    t.push({ test: "T1a_cold_write_bookA", usage: await call(apiKey, P, "Book A, Chapter 1: Write the opening paragraph of a literary novel about a lighthouse keeper.") });
    // T1b: warm read — same writer, same book A, next section, seconds later. Expect cache_read > 0.
    t.push({ test: "T1b_warm_read_bookA", usage: await call(apiKey, P, "Book A, Chapter 1, Section 2: Continue the lighthouse keeper novel; a storm approaches.") });
    // T2: cross-book — identical static prefix, different book. Empirical test of cross-book prefix reuse.
    t.push({ test: "T2_cross_book_bookB", usage: await call(apiKey, P, "Book B, Chapter 1: Write the opening paragraph of a literary novel about a retired violinist in Vienna.") });
    // T3: below-threshold control — short system prompt (~60 tokens), twice. Expect NO caching and NO error.
    const shortSys = "You are a concise literary writer. No markdown.";
    t.push({ test: "T3a_below_threshold", usage: await call(apiKey, shortSys, "Write one sentence about rain.") });
    t.push({ test: "T3b_below_threshold_repeat", usage: await call(apiKey, shortSys, "Write one sentence about snow.") });

    return json(results);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Benchmark failed" }, 500);
  }
});
