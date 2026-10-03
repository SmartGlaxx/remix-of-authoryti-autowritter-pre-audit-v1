// Live pricing: parse the gateway model catalog into USD-per-1M prices (pure), plus a
// 24h-stale refresh used server-side. Prices never live in UI code.
import { MODEL_REGISTRY } from "./registry.ts";

export interface LivePrice { inputPerM: number | null; cachedInputPerM: number | null; cacheWritePerM: number | null; outputPerM: number | null }
export type PriceMap = Record<string, LivePrice>;
export const PRICE_TTL_MS = 24 * 60 * 60 * 1000;

const perM = (tiers: unknown): number | null => {
  const c = Array.isArray(tiers) ? Number((tiers[0] as { cost?: string })?.cost) : NaN;
  return Number.isFinite(c) ? Math.round(c * 1e6 * 1e6) / 1e6 : null;
};

/** Gateway catalog JSON → prices for registry models (by gatewayId). */
// deno-lint-ignore no-explicit-any
export function parseGatewayCatalog(catalog: any): PriceMap {
  const out: PriceMap = {};
  const byId = new Map<string, any>((catalog?.data ?? []).map((m: any) => [m.id, m]));
  for (const m of MODEL_REGISTRY) {
    const g = m.gatewayId && byId.get(m.gatewayId);
    if (!g?.pricing) continue;
    const t = g.pricing.input?.text ?? {};
    out[m.key] = { inputPerM: perM(t.tiers), cachedInputPerM: perM(t.cache_read?.tiers), cacheWritePerM: perM(t.cache_write?.tiers), outputPerM: perM(g.pricing.output?.text?.tiers) };
  }
  return out;
}

/** Official DeepSeek pricing page → per-1M USD at PEAK rates (conservative; off-peak is half).
 * Columns are deepseek-flash then deepseek-v4-pro. Thinking tokens are billed as output. */
export const DEEPSEEK_PRICING_URL = "https://api-docs.deepseek.com/quick_start/pricing";
export function parseDeepSeekPricingPage(html: string): PriceMap {
  const t = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "|").replace(/&nbsp;/g, " ").replace(/\|[\s|]*/g, "|");
  const i = t.indexOf("PRICING");
  if (i < 0) return {};
  const seg = t.slice(i, i + 1500);
  const peak = (label: RegExp): [number, number] | null => {
    const m = seg.match(new RegExp(label.source + "[^$]*?PEAK\\|\\$([\\d.]+)\\|\\$([\\d.]+)\\|PEAK\\|\\$([\\d.]+)\\|\\$([\\d.]+)"));
    return m ? [Number(m[3]), Number(m[4])] : null;
  };
  const hit = peak(/CACHE HIT\)/), miss = peak(/CACHE MISS\)/), out = peak(/OUTPUT TOKENS/);
  if (!hit || !miss || !out || [...hit, ...miss, ...out].some((n) => !Number.isFinite(n))) return {};
  return {
    "deepseek/deepseek-flash": { inputPerM: miss[0], cachedInputPerM: hit[0], cacheWritePerM: null, outputPerM: out[0] },
    "deepseek/deepseek-v4-pro": { inputPerM: miss[1], cachedInputPerM: hit[1], cacheWritePerM: null, outputPerM: out[1] },
  };
}

export function isStale(fetchedAt: string | null | undefined, now = Date.now()): boolean {
  return !fetchedAt || now - new Date(fetchedAt).getTime() > PRICE_TTL_MS;
}

/** Loads the cache; refreshes from the gateway when older than 24h. On failure keeps last prices. */
// deno-lint-ignore no-explicit-any
export async function loadPrices(admin: any, apiKey: string | undefined, force = false): Promise<{ prices: PriceMap; fetchedAt: string | null; sources: string[] }> {
  const read = async () => {
    const { data } = await admin.from("provider_pricing_cache").select("*");
    const prices: PriceMap = {}; let newest: string | null = null; const sources = new Set<string>();
    for (const r of data ?? []) {
      prices[r.model_key] = { inputPerM: r.input_price_per_m, cachedInputPerM: r.cached_input_price_per_m, cacheWritePerM: r.cache_write_price_per_m, outputPerM: r.output_price_per_m };
      if (!newest || r.fetched_at > newest) newest = r.fetched_at;
      sources.add(r.source);
    }
    return { prices, fetchedAt: newest, sources: [...sources] };
  };
  const cur = await read();
  if (!force && !isStale(cur.fetchedAt)) return cur;
  const now = new Date().toISOString();
  try {
    const res = await fetch(DEEPSEEK_PRICING_URL);
    if (res.ok) {
      const ds = parseDeepSeekPricingPage(await res.text());
      const rows = Object.entries(ds).map(([k, p]) => ({ model_key: k, provider: "deepseek", input_price_per_m: p.inputPerM, cached_input_price_per_m: p.cachedInputPerM, cache_write_price_per_m: null, output_price_per_m: p.outputPerM, source: "DeepSeek official pricing page (peak rate)", fetched_at: now }));
      if (rows.length) await admin.from("provider_pricing_cache").upsert(rows, { onConflict: "model_key" });
    }
  } catch { /* keep last DeepSeek prices */ }
  if (!apiKey) return await read();
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return await read();
    const parsed = parseGatewayCatalog(await res.json());
    const rows = Object.entries(parsed).map(([k, p]) => ({
      model_key: k, provider: MODEL_REGISTRY.find((m) => m.key === k)!.provider,
      input_price_per_m: p.inputPerM, cached_input_price_per_m: p.cachedInputPerM, cache_write_price_per_m: p.cacheWritePerM, output_price_per_m: p.outputPerM,
      source: "gateway catalog", fetched_at: now,
    }));
    if (rows.length) await admin.from("provider_pricing_cache").upsert(rows, { onConflict: "model_key" });
    return await read();
  } catch { return await read(); }
}
