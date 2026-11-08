// OpenAI image generation for covers and illustrations.
// Order: the user's own OpenAI key (from app Settings) first; if absent or it
// fails for a non-content reason, fall back to the in-app gateway's OpenAI model.
import { decryptKey } from "./keyCrypto.ts";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";
const DIRECT = "https://api.openai.com/v1";
export const GATEWAY_IMAGE_MODEL = "openai/gpt-image-2.5-sunburst";
export const DIRECT_IMAGE_MODEL = "gpt-image-2";

export type ImageSize = "1024x1536" | "1536x1024" | "1024x1024";

export class ImageError extends Error {
  constructor(msg: string, public status: number) { super(msg); }
}

async function loadUserOpenAIKey(admin: any, userId: string): Promise<string | null> {
  try {
    const secret = Deno.env.get("BYOK_ENCRYPTION_KEY");
    if (!secret) return null;
    const { data } = await admin.from("user_provider_keys").select("ciphertext, iv").eq("user_id", userId).eq("provider", "openai").maybeSingle();
    if (!data?.ciphertext) return null;
    return await decryptKey(secret, userId, data.ciphertext, data.iv);
  } catch (e) {
    console.error("user openai key load failed", e);
    return null;
  }
}

async function toBlob(src: string): Promise<Blob> {
  if (src.startsWith("data:")) {
    const [head, b64] = src.split(",", 2);
    const mime = head.slice(5).split(";")[0] || "image/png";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  const r = await fetch(src);
  if (!r.ok) throw new ImageError("Could not load the reference image", 400);
  return await r.blob();
}

async function call(base: string, key: string, model: string, prompt: string, size: ImageSize, refs: string[], quality?: 'low'): Promise<Response> {
  if (refs.length === 0) {
    return fetch(`${base}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, size, n: 1, ...(quality ? { quality } : {}) }),
    });
  }
  const form = new FormData();
  form.set("model", model);
  form.set("prompt", prompt);
  form.set("size", size);
  if (quality) form.set('quality', quality);
  const blobs = await Promise.all(refs.map(toBlob));
  blobs.forEach((b, i) => form.append(refs.length > 1 ? "image[]" : "image", b, `ref${i}.png`));
  return fetch(`${base}/images/edits`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
}

async function readImage(res: Response): Promise<string> {
  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (b64) return `data:image/png;base64,${b64}`;
  const url = data?.data?.[0]?.url;
  if (url) return url;
  throw new ImageError("The AI did not return an image. Try adjusting your description.", 422);
}

function isContentRefusal(status: number, text: string) {
  return status === 400 && /moderation|safety|content_policy|rejected/i.test(text);
}

/** Returns a data URL (or https URL) for one generated image. */
export async function generateOpenAIImage(opts: { admin: any; userId: string; prompt: string; size: ImageSize; references?: string[]; quality?: 'low'; noFallback?: boolean }): Promise<string> {
  const refs = (opts.references || []).filter(Boolean).slice(0, 4);
  const userKey = await loadUserOpenAIKey(opts.admin, opts.userId);
  if (userKey) {
    const res = await call(DIRECT, userKey, DIRECT_IMAGE_MODEL, opts.prompt, opts.size, refs, opts.quality);
    if (res.ok) return readImage(res);
    const t = await res.text();
    console.error("openai direct image error", res.status, t.slice(0, 500));
    if (isContentRefusal(res.status, t)) throw new ImageError("This image request was declined by the image service's content rules.", 400);
    if (opts.noFallback) throw new ImageError(`OpenAI image request failed (${res.status}); no replacement model was used.`, res.status);
    // otherwise fall through to the in-app gateway
  }
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (!lovableKey) throw new ImageError("Image service is not configured", 500);
  const res = await call(GATEWAY, lovableKey, GATEWAY_IMAGE_MODEL, opts.prompt, opts.size, refs, opts.quality);
  if (res.ok) return readImage(res);
  const t = await res.text();
  console.error("gateway image error", res.status, t.slice(0, 500));
  if (res.status === 429) throw new ImageError("Too many requests right now. Please wait a moment and try again.", 429);
  if (res.status === 402) throw new ImageError("AI credits have run out. Please add credits to continue.", 402);
  if (isContentRefusal(res.status, t)) throw new ImageError("This image request was declined by the image service's content rules.", 400);
  throw new ImageError(`Image service error (${res.status})`, res.status === 403 ? 403 : res.status >= 500 ? 502 : res.status);
}
