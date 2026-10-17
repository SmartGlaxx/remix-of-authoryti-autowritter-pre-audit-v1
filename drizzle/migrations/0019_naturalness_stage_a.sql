-- Writer style adaptations: reversible overlays, never mutate base profiles
CREATE TABLE public.writer_style_adaptations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  writer_id text NOT NULL,
  book_id uuid REFERENCES public.books(id) ON DELETE CASCADE,
  dimension text NOT NULL,
  adjustment jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'author' CHECK (source IN ('author','feedback','system')),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','active','reverted')),
  version integer NOT NULL DEFAULT 1,
  reverted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.writer_style_adaptations TO authenticated;
GRANT ALL ON public.writer_style_adaptations TO service_role;
ALTER TABLE public.writer_style_adaptations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage own adaptations" ON public.writer_style_adaptations
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_wsa_user_writer ON public.writer_style_adaptations(user_id, writer_id);

-- Book-level literary artifacts (motifs, scenery, title plans) — belong to the book, never the writer
CREATE TABLE public.book_literary_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  artifact_type text NOT NULL CHECK (artifact_type IN ('motif','scenery','title_plan','verbal_motif','sensory_palette')),
  label text NOT NULL,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.book_literary_artifacts TO authenticated;
GRANT ALL ON public.book_literary_artifacts TO service_role;
ALTER TABLE public.book_literary_artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage own book artifacts" ON public.book_literary_artifacts
  FOR ALL TO authenticated
  USING (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND b.user_id = auth.uid()))
  WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND b.user_id = auth.uid()));
CREATE INDEX idx_bla_book ON public.book_literary_artifacts(book_id);

-- Naturalness findings: advisory only; owners may change status/notes only
CREATE TABLE public.naturalness_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  chapter_index integer NOT NULL,
  subsection_index integer,
  category text NOT NULL,
  severity text NOT NULL DEFAULT 'advisory' CHECK (severity IN ('info','advisory')),
  message text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','dismissed')),
  author_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.naturalness_findings TO authenticated;
GRANT ALL ON public.naturalness_findings TO service_role;
ALTER TABLE public.naturalness_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read findings" ON public.naturalness_findings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owners update findings" ON public.naturalness_findings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_nf_book ON public.naturalness_findings(book_id, chapter_index);

CREATE OR REPLACE FUNCTION public.protect_naturalness_finding()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'authenticated' THEN
    IF NEW.book_id <> OLD.book_id OR NEW.user_id <> OLD.user_id OR NEW.chapter_index <> OLD.chapter_index
       OR NEW.subsection_index IS DISTINCT FROM OLD.subsection_index OR NEW.category <> OLD.category
       OR NEW.severity <> OLD.severity OR NEW.message <> OLD.message OR NEW.evidence <> OLD.evidence
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
      RAISE EXCEPTION 'Only status and notes may be changed';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_protect_naturalness_finding BEFORE UPDATE ON public.naturalness_findings
  FOR EACH ROW EXECUTE FUNCTION public.protect_naturalness_finding();

CREATE TRIGGER trg_wsa_updated BEFORE UPDATE ON public.writer_style_adaptations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_bla_updated BEFORE UPDATE ON public.book_literary_artifacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();