ALTER TABLE public.book_model_configs
  ADD COLUMN IF NOT EXISTS profile_writer text,
  ADD COLUMN IF NOT EXISTS profile_tier text CHECK (profile_tier IS NULL OR profile_tier IN ('economy','balanced','professional','maximum'));

ALTER TABLE public.books ADD COLUMN IF NOT EXISTS voice_manifest jsonb;

CREATE TABLE public.provider_pricing_cache (
  model_key text PRIMARY KEY,
  provider text NOT NULL,
  input_price_per_m numeric(12,6),
  cached_input_price_per_m numeric(12,6),
  cache_write_price_per_m numeric(12,6),
  output_price_per_m numeric(12,6),
  source text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.provider_pricing_cache TO authenticated;
GRANT ALL ON public.provider_pricing_cache TO service_role;
ALTER TABLE public.provider_pricing_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read prices" ON public.provider_pricing_cache FOR SELECT TO authenticated USING (true);