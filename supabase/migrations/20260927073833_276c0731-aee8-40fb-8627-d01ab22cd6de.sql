CREATE TABLE public.book_model_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL UNIQUE REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'legacy' CHECK (mode IN ('legacy','optimized','single','custom')),
  single_model text,
  role_models jsonb NOT NULL DEFAULT '{}'::jsonb,
  fallbacks jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.book_model_configs TO authenticated;
GRANT ALL ON public.book_model_configs TO service_role;
ALTER TABLE public.book_model_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage own model config" ON public.book_model_configs FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND b.user_id = auth.uid()));
CREATE TRIGGER trg_book_model_configs_updated BEFORE UPDATE ON public.book_model_configs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.user_provider_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('openai','anthropic','deepseek','gemini')),
  ciphertext text NOT NULL,
  iv text NOT NULL,
  last4 text NOT NULL,
  prefix text,
  status text NOT NULL DEFAULT 'untested' CHECK (status IN ('untested','valid','invalid')),
  last_tested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);
REVOKE ALL ON public.user_provider_keys FROM anon, authenticated;
GRANT ALL ON public.user_provider_keys TO service_role;
ALTER TABLE public.user_provider_keys ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_user_provider_keys_updated BEFORE UPDATE ON public.user_provider_keys FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.ai_usage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id uuid REFERENCES public.books(id) ON DELETE CASCADE,
  role text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  credential_source text NOT NULL,
  input_tokens integer,
  output_tokens integer,
  cached_input_tokens integer,
  estimated_cost_usd numeric,
  success boolean NOT NULL,
  error_code text,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_usage_records TO authenticated;
GRANT ALL ON public.ai_usage_records TO service_role;
ALTER TABLE public.ai_usage_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read own usage" ON public.ai_usage_records FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX idx_ai_usage_user_created ON public.ai_usage_records (user_id, created_at DESC);