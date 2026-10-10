CREATE TABLE public.editorial_validation_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  chapter_index integer NOT NULL,
  subsection_index integer NOT NULL,
  content_hash text NOT NULL,
  code text NOT NULL,
  category text NOT NULL CHECK (category IN ('deterministic','plan_intent','continuity','epistemic','writing_quality')),
  severity text NOT NULL CHECK (severity IN ('info','warning','minor','moderate','material')),
  route text NOT NULL CHECK (route IN ('auto_repair','editorial_review','author_approval')),
  message text NOT NULL,
  excerpt text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACCEPTED','DISMISSED','RESOLVED','APPROVED_REWRITE','REJECTED_REWRITE')),
  author_notes text,
  dedup_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.editorial_validation_findings TO authenticated;
GRANT UPDATE (status, author_notes) ON public.editorial_validation_findings TO authenticated;
GRANT ALL ON public.editorial_validation_findings TO service_role;
ALTER TABLE public.editorial_validation_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read editorial findings" ON public.editorial_validation_findings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owners update finding status" ON public.editorial_validation_findings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX editorial_findings_section_idx ON public.editorial_validation_findings (book_id, chapter_index, subsection_index);
CREATE TRIGGER editorial_findings_updated_at BEFORE UPDATE ON public.editorial_validation_findings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();