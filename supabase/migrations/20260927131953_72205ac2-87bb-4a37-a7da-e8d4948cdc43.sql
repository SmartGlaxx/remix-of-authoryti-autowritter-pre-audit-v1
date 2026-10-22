CREATE TABLE public.continuity_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chapter_index integer NOT NULL,
  subsection_index integer NOT NULL,
  subsection_id text,
  generation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  original_hash text NOT NULL,
  final_hash text,
  status text NOT NULL CHECK (status IN ('PROCESSING','PASSED','PASSED_WITH_WARNINGS','REVISED','NEEDS_REVIEW','CHECK_FAILED')),
  max_severity text CHECK (max_severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  confidence numeric,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  attempts jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision_count integer NOT NULL DEFAULT 0,
  original_text text NOT NULL,
  final_text text,
  resolution_status text NOT NULL DEFAULT 'open' CHECK (resolution_status IN ('open','auto_resolved','none_needed','needs_review','failed')),
  model_identifier text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.continuity_checks TO authenticated;
GRANT ALL ON public.continuity_checks TO service_role;
ALTER TABLE public.continuity_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners can view their continuity checks" ON public.continuity_checks FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX continuity_checks_section_idx ON public.continuity_checks (book_id, chapter_index, subsection_index, created_at DESC);
CREATE TRIGGER update_continuity_checks_updated_at BEFORE UPDATE ON public.continuity_checks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();