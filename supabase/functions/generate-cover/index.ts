import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

// Editing sends the chosen cover image back, so allow larger bodies.
const MAX_PAYLOAD_BYTES = 15_000_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max).trim() : "");

async function getAuthUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims) return null;
  return { id: data.claims.sub as string };
}

import { generateOpenAIImage, ImageError } from "../_shared/ai/openaiImage.ts";
const GatewayError = ImageError;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const len = parseInt(req.headers.get("content-length") || "0");
    if (len > MAX_PAYLOAD_BYTES) return json({ error: "Payload too large" }, 413);

    const user = await getAuthUser(req);
    if (!user) return json({ error: "Unauthorized" }, 401);


    const body = await req.json();
    const mode = body.mode === "edit" ? "edit" : "generate";

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: creditCheck } = await admin.rpc("check_and_deduct_word_credits", { _user_id: user.id, _estimated_words: 1000, _skip_daily_cap: true });
    const credit = creditCheck as Record<string, unknown> | null;
    if (!credit?.allowed) return json({ error: (credit?.reason as string) || "Insufficient credits" }, 402);

    if (mode === "edit") {
      const image = typeof body.image === "string" ? body.image : "";
      const instruction = str(body.instruction, 1000);
      if (!image.startsWith("data:image/") && !image.startsWith("https://")) return json({ error: "Missing image to edit" }, 400);
      if (instruction.length < 3) return json({ error: "Tell the AI what to change" }, 400);
      const prompt = `Edit this book cover. Apply ONLY this change: ${instruction}

Keep everything else exactly the same: same composition, same colors, same lighting, same typography, same text wording and placement, same aspect ratio. Do not add or remove anything that was not asked for.`;
      const url = await generateOpenAIImage({ admin, userId: user.id, prompt, size: "1024x1536", references: [image] });
      return json({ cover: url });
    }

    const o = body.options || {};
    const description = str(o.description, 1500);
    const title = str(o.title, 200) || "Untitled";
    const author = str(o.author, 120);
    const subtitle = str(o.subtitle, 200);
    const font = str(o.font, 80) || "elegant serif";
    const textColor = str(o.textColor, 60) || "white";
    const textPosition = str(o.textPosition, 60) || "top";
    const imageType = str(o.imageType, 80) || "digital painting";
    const theme = str(o.theme, 80) || "dramatic";
    const bookType = str(o.bookType, 60) || "book";
    const toggles: string[] = [];
    if (o.minimalist) toggles.push("minimalist, clean composition with generous empty space");
    if (o.darkMood) toggles.push("dark, moody palette with deep shadows");
    if (o.showCharacter) toggles.push("feature a main character as the focal point");
    if (o.textured) toggles.push("subtle paper or canvas texture");
    if (o.border) toggles.push("a thin decorative border frame");
    const numCovers = Math.min(4, Math.max(1, Number(o.count) || 4));

    const results = await Promise.allSettled(Array.from({ length: numCovers }, (_, i) => {
      const prompt = `Design a complete, finished, print-ready front book cover for a ${bookType}.

Title text (spell exactly): "${title}"
${subtitle ? `Subtitle text (spell exactly): "${subtitle}"\n` : ""}${author ? `Author name (spell exactly): "${author}"\n` : ""}
Artwork style: ${imageType}
Theme / mood: ${theme}
Scene: ${description || "an evocative scene that fits the title"}
${toggles.length ? `Extra style: ${toggles.join("; ")}\n` : ""}
Typography: render the title in a ${font} typeface, colored ${textColor}, positioned at the ${textPosition} of the cover. Text must be crisp, legible, correctly spelled, and integrated professionally with the artwork. Include no other words.
Format: portrait, 2:3 book cover proportions, full bleed.
This is option ${i + 1} of ${numCovers}: make it a clearly distinct interpretation from the others.`;
      return generateOpenAIImage({ admin, userId: user.id, prompt, size: "1024x1536" });
    }));

    const covers = results.filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled").map((r) => r.value);
    if (covers.length === 0) {
      const first = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      throw first?.reason ?? new Error("Failed to generate any covers");
    }
    return json({ covers });
  } catch (error) {
    console.error("generate-cover error:", error);
    const status = error instanceof GatewayError ? error.status : 500;
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, status);
  }
});
