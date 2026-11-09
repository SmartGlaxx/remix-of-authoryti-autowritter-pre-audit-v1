import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { generateAIText, statusForAIError } from "../_shared/ai/client.ts";
import { AIProviderError } from "../_shared/ai/providers.ts";
import { createCharacterReference } from '../_shared/narrative/characterReferenceServer.ts';
import { missingReferenceNames } from '../_shared/narrative/characterReference.ts';
import { createAIDeps, aiBookContext } from "../_shared/ai/server.ts";

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
  const patterns = [/ignore\s+(all\s+)?previous\s+instructions/i, /you\s+are\s+now\s+/i, /system\s*:\s*/i, /\[INST\]/i, /<<SYS>>/i, /forget\s+(everything|all|your)\s/i];
  return patterns.some(p => p.test(text));
}

function validateInput(body: any): string | null {
  if (!body || typeof body !== "object") return "Invalid request body";
  if (!body.book || typeof body.book !== "object") return "Missing book data";
  if (!body.outline || typeof body.outline !== "object") return "Missing outline data";
  if (!body.book.title || typeof body.book.title !== "string" || body.book.title.length > 500) return "Invalid book title";
  if (detectPromptInjection(body.book.title)) return "Input contains prohibited patterns";
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
  const { data } = await supabase.rpc("check_rate_limit", { _user_id: userId, _function_name: functionName, _max_per_hour: 10, _max_per_day: 50 });
  return data as boolean ?? true;
}

async function auditLog(userId: string, action: string, resourceType: string, resourceId?: string, metadata?: Record<string, unknown>) {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  await supabase.from("audit_logs").insert({ user_id: userId, action, resource_type: resourceType, resource_id: resourceId, metadata: metadata || {} });
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

    const allowed = await checkRateLimit(auth.user.id, "generate-characters");
    if (!allowed) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json();
    // This endpoint has no image mock: tests must never reach a paid image or vision call.
    if (body.testMode === true || req.headers.get('x-ai-test-mode') === '1') return new Response(JSON.stringify({error:'test_mode_blocked'}),{status:403,headers:{...corsHeaders,'Content-Type':'application/json'}});
    const validationError = validateInput(body);
    if (validationError) return new Response(JSON.stringify({ error: validationError }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { ieltsBand } = body;
    const ownerAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: savedBook, error: bookError } = await ownerAdmin.from('books').select('id,user_id,title,theme,book_type,audience,outline').eq('id',body.book.id).eq('user_id',auth.user.id).maybeSingle();
    if (bookError || !savedBook) return new Response(JSON.stringify({error:'Book not found'}),{status:404,headers:{...corsHeaders,'Content-Type':'application/json'}});
    const book = { ...savedBook, bookType:savedBook.book_type };
    const outline = savedBook.outline;
    if (!Array.isArray(outline?.chapters)) throw new Error('Save the outline before preparing references');
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    await auditLog(auth.user.id, "generate_characters", "book", book.id, { title: book.title });

    const band = ieltsBand || 7;
    const descriptionGuidelines = getDescriptionGuidelines(band);
    
    // Planned books: the author-approved cast is authoritative — one card per member, names copied exactly.
    const { data: castRows } = await ownerAdmin.from('story_characters').select('id,name,role').eq('book_id',book.id).eq('user_id',auth.user.id).eq('is_active',true);
    const approvedCast = (castRows ?? []).map((c: any) => ({ id: c.id, name: c.name, role: c.role ?? null }));
    // One cast member per request keeps each call well inside the function time limit; the app repeats until none remain.
    const missing = missingReferenceNames(approvedCast.map((c) => c.name), outline.characters ?? []);
    if (approvedCast.length && !missing.length) return new Response(JSON.stringify({ characters: outline.characters ?? [], visualStyleGuide: outline.visualStyleGuide ?? '', remaining: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const target = approvedCast.find((c) => c.name.trim() === missing[0]) ?? null;
    const existingCards = (outline.characters ?? []).map((c: any) => ({ id: c.id, name: c.name, visualDescription: c.visualDescription, reference: c.reference ? { heightCm: c.reference.heightCm, tells: c.reference.tells } : undefined }));
    const extractPrompt = `Analyze this book outline and extract EVERY named fictional character. Do not create characters from implied people, real public figures, objects, or instructional roles such as Reader, Colleague and Bill payer. Use existing cast ids and profiles when available; do not invent extra cast.
EXISTING CAST: ${JSON.stringify(existingCards)}${target ? `
APPROVED CAST MEMBER (authoritative): return exactly ONE card, for this person only, using the given id and the name exactly as written. Keep them visually distinct from the existing cast: ${JSON.stringify(target)}` : ''}

BOOK: "${book.title}"
THEME: "${book.theme}"
TYPE: ${book.bookType}
AUDIENCE: ${book.audience}
TARGET LANGUAGE COMPLEXITY (IELTS Band ${band}):
${descriptionGuidelines}

OUTLINE:
${JSON.stringify(outline.chapters.map((ch: any) => ({
  title: ch.title,
  summary: ch.summary,
  subsections: ch.subsections.map((s: any) => ({ title: s.title, goal: s.goal }))
})), null, 2)}

For EACH character, provide an EXHAUSTIVE profile with ALL sections:
IDENTITY, PHYSICAL APPEARANCE, HAIR, FASHION & STYLE, VOICE & MANNERISMS, PERSONALITY, BACKSTORY, ROLE IN STORY.

Also provide:
- A brief description (for quick reference)
- A visualDescription for illustration consistency
- reference: {heightCm: exact positive number, weightKg: exact positive number, measurementSource: "designed", tells:[{state,cue,purpose}], desireLine, heldBackFeature}. Design height and weight consistent with age/outline; these are design decisions NOT image measurements. 4–10 distinct functional tells with purpose betray/assist/reveal/endanger/mislead/comfort, including state "at-ease". Avoid duplicating cues across cast. Give 5–7 noticeability-ranked introduction features (introFeatures), top two most visible, one signature held back. Preserve explicit author facts.

Return ONLY valid JSON:
{
  "characters": [
    {
      "id": "character_id",
      "name": "Character Name",
      "description": "Quick reference summary",
      "visualDescription": "Visual description for illustration",
      "role": "protagonist|supporting|minor|background",
      "identity": { ... },
      "appearance": { ... },
      "hair": { ... },
      "fashion": { ... },
      "voice": { ... },
      "personality": { ... },
      "backstory": { ... },
      "storyRole": { ... }
    }
  ],
  "visualStyleGuide": "Overall art style description for the book"
}`;

    function getDescriptionGuidelines(band: number): string {
      switch (band) {
        case 5: return `- Use VERY simple words a young child would understand`;
        case 6: return `- Use simple, clear vocabulary for older children`;
        case 7: return `- Standard vocabulary for general readers`;
        case 8: return `- Sophisticated vocabulary for academic readers`;
        case 9: return `- Advanced, literary vocabulary`;
        default: return `- Standard vocabulary`;
      }
    }

    const __admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const __ctx = await aiBookContext(__admin, book.id, auth.user.id);
    let content: string;
    try {
      const __r = await generateAIText({ role: "character_generator", config: __ctx.config, userId: auth.user.id, bookId: __ctx.bookId, request: { user: extractPrompt, temperature: 0.5 } }, createAIDeps(__admin, auth.user.id));
      content = __r.text;
    } catch (e) {
      if (e instanceof AIProviderError) return new Response(JSON.stringify({ error: e.message }), { status: statusForAIError(e), headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw e;
    }

    
    let parsed;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      parsed = JSON.parse(jsonMatch[1].trim());
    } catch { throw new Error("Failed to parse character data"); }

    const characters = parsed.characters;
    if (!Array.isArray(characters) || characters.some((c: any) => typeof c.id !== 'string' || typeof c.name !== 'string' || !c.reference || !Array.isArray(c.reference.tells))) throw new Error('Invalid character card data');
    const visualStyleGuide = parsed.visualStyleGuide || "";

    const charactersWithPortraits = [];
    
    const imgAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    for (const character of characters) {
      const existing = outline.characters?.find((c: any) => c.id === character.id && c.reference?.locked);
      const prepared = existing ?? await createCharacterReference(imgAdmin,auth.user.id,book.id,character,charactersWithPortraits.map(c=>c.reference));
      charactersWithPortraits.push(prepared);
      // Checkpoint after each character; retry never discards completed references.
      const { data: latest } = await imgAdmin.from('books').select('outline').eq('id',book.id).eq('user_id',auth.user.id).single();
      if (!latest?.outline) throw new Error('Book outline unavailable');
      const merged = [...(latest.outline.characters ?? []).filter((c: any)=>c.id!==prepared.id),prepared];
      const { error } = await imgAdmin.from('books').update({outline:{...latest.outline,characters:merged,visualStyleGuide}}).eq('id',book.id).eq('user_id',auth.user.id);
      if (error) throw error;
    }

    const remaining = target ? Math.max(0, missing.length - 1) : 0;
    return new Response(JSON.stringify({ characters: charactersWithPortraits, visualStyleGuide, remaining }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("generate-characters error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: error instanceof AIProviderError ? statusForAIError(error) : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
