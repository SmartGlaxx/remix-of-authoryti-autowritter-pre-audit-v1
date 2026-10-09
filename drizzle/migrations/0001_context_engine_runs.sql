CREATE TABLE public.context_engine_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  engine text NOT NULL CHECK (engine IN ('legacy','adaptive')),
  chapter_index integer NOT NULL,
  subsection_index integer NOT NULL,
  book_type text NOT NULL,
  profile_id text,
  context_words integer NOT NULL DEFAULT 0,
  prompt_words integer NOT NULL DEFAULT 0,
  candidates integer NOT NULL DEFAULT 0,
  included integer NOT NULL DEFAULT 0,
  omitted jsonb NOT NULL DEFAULT '{}'::jsonb,
  fell_back boolean NOT NULL DEFAULT false,
  model text,
  input_tokens integer,
  cached_input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric,
  latency_ms integer,
  output_words integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.context_engine_runs TO authenticated;
GRANT ALL ON public.context_engine_runs TO service_role;
ALTER TABLE public.context_engine_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read their context runs" ON public.context_engine_runs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX context_engine_runs_book_idx ON public.context_engine_runs (book_id, created_at DESC);