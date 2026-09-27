import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { generateAIText, statusForAIError } from "../_shared/ai/client.ts";
import { AIProviderError } from "../_shared/ai/providers.ts";
import { aiBookContext } from "../_shared/ai/server.ts";
import { createAIDeps } from "../_shared/ai/server.ts";

// ── Security Config ──
const MAX_PAYLOAD_BYTES = 50_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function wafCheck(req: Request): string | null {
  const ua = (req.headers.get("user-agent") || "").toLowerCase();
  const blocked = ["sqlmap", "nikto", "nessus", "masscan", "zgrab"];
  for (const b of blocked) { if (ua.includes(b)) return `Blocked: ${b}`; }
  return null;
}

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
  ];
  return patterns.some(p => p.test(text));
}

function validateInput(body: any): string | null {
  if (!body || typeof body !== "object") return "Invalid request body";
  if (!body.content || typeof body.content !== "string") return "Missing content";
  if (body.content.length > 100_000) return "Content too long";
  if (!body.type || !["subsection", "chapter"].includes(body.type)) return "Invalid type";
  if (detectPromptInjection(body.content)) return "Input contains prohibited patterns";
  return null;
}

async function getAuthUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims) return null;
  const user = { id: data.claims.sub as string, email: data.claims.email as string };
  return { user, supabase };
}

async function checkRateLimit(userId: string, functionName: string) {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data } = await supabase.rpc("check_rate_limit", { _user_id: userId, _function_name: functionName, _max_per_hour: 60, _max_per_day: 500 });
  return data as boolean ?? true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const wafResult = wafCheck(req);
    if (wafResult) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const contentLength = parseInt(req.headers.get("content-length") || "0");
    if (contentLength > MAX_PAYLOAD_BYTES) return new Response(JSON.stringify({ error: "Payload too large" }), { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const auth = await getAuthUser(req);
    if (!auth) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const allowed = await checkRateLimit(auth.user.id, "summarize-content");
    if (!allowed) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json();
    const validationError = validateInput(body);
    if (validationError) return new Response(JSON.stringify({ error: validationError }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { content, type } = body;

    const wordLimit = type === "chapter" ? "300-500" : "50-100";
    
    const systemPrompt = `You are a concise summarizer. Create a ${type} summary in ${wordLimit} words.

REQUIREMENTS:
- Capture key facts, events, and character developments
- Preserve important details for continuity
- Be factual, not interpretive
- Focus on what happens, not how it's written

Return ONLY the summary text, nothing else.`;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const ctx = await aiBookContext(admin, body.bookId, auth.user.id);
    let summary: string;
    try {
      const r = await generateAIText({ role: "summarizer", config: ctx.config, userId: auth.user.id, bookId: ctx.bookId, request: { system: systemPrompt, user: `Summarize this ${type}:\n\n${content}`, temperature: 0.3, reasoning: "low" } }, createAIDeps(admin, auth.user.id));
      summary = r.text;
    } catch (e) {
      if (e instanceof AIProviderError) return new Response(JSON.stringify({ error: e.message }), { status: statusForAIError(e), headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw e;
    }

    return new Response(JSON.stringify({ summary: summary.trim() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("summarize-content error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
