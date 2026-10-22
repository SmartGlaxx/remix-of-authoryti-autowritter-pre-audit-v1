CREATE TABLE public.book_master_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','SUPERSEDED','CANCELLED')),
  genre_adapter_type text NOT NULL DEFAULT 'fiction',
  premise text NOT NULL DEFAULT '',
  master_synopsis text NOT NULL DEFAULT '',
  intended_ending text NOT NULL DEFAULT '',
  genre_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  major_reveals jsonb NOT NULL DEFAULT '[]'::jsonb,
  twist_alternatives jsonb NOT NULL DEFAULT '[]'::jsonb,
  supersedes_id uuid REFERENCES public.book_master_plans(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, version),
  UNIQUE (id, book_id)
);
CREATE UNIQUE INDEX book_master_plans_one_approved ON public.book_master_plans(book_id) WHERE status = 'APPROVED';

CREATE TABLE public.book_progressive_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  master_plan_id uuid NOT NULL,
  parent_plan_id uuid,
  plan_level text NOT NULL CHECK (plan_level IN ('CHAPTER','SECTION','BEATS')),
  chapter_index integer NOT NULL CHECK (chapter_index >= 0),
  subsection_index integer CHECK (subsection_index IS NULL OR subsection_index >= 0),
  plan_status text NOT NULL DEFAULT 'PLANNED' CHECK (plan_status IN ('PLANNED','READY','SUPERSEDED','CANCELLED')),
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  dependencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((plan_level = 'CHAPTER' AND subsection_index IS NULL) OR (plan_level <> 'CHAPTER' AND subsection_index IS NOT NULL)),
  FOREIGN KEY (master_plan_id, book_id) REFERENCES public.book_master_plans(id, book_id) ON DELETE CASCADE,
  UNIQUE (id, book_id)
);
ALTER TABLE public.book_progressive_plans
  ADD CONSTRAINT book_progressive_plans_parent_fk FOREIGN KEY (parent_plan_id, book_id) REFERENCES public.book_progressive_plans(id, book_id) ON DELETE CASCADE;
CREATE UNIQUE INDEX book_progressive_plans_version_uq ON public.book_progressive_plans(book_id, master_plan_id, plan_level, chapter_index, COALESCE(subsection_index, -1), version);
CREATE INDEX book_progressive_plans_lookup ON public.book_progressive_plans(book_id, chapter_index, subsection_index);

CREATE TABLE public.book_section_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  chapter_index integer NOT NULL CHECK (chapter_index >= 0),
  subsection_index integer NOT NULL CHECK (subsection_index >= 0),
  master_plan_id uuid,
  section_plan_id uuid,
  content_hash text NOT NULL,
  manuscript_status text NOT NULL DEFAULT 'DRAFTED' CHECK (manuscript_status IN ('DRAFTED','ACCEPTED','ESTABLISHED','REVISED')),
  extraction_status text NOT NULL DEFAULT 'NOT_STARTED' CHECK (extraction_status IN ('NOT_STARTED','PENDING_EXTRACTION','EXTRACTED','FAILED')),
  attempts integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, chapter_index, subsection_index, content_hash),
  FOREIGN KEY (master_plan_id, book_id) REFERENCES public.book_master_plans(id, book_id),
  FOREIGN KEY (section_plan_id, book_id) REFERENCES public.book_progressive_plans(id, book_id)
);
CREATE INDEX book_section_acceptances_lookup ON public.book_section_acceptances(book_id, chapter_index, subsection_index);

-- Immutability: approved master plans / ready progressive plans may only change status.
CREATE OR REPLACE FUNCTION public.protect_master_plan_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status IN ('APPROVED','SUPERSEDED','CANCELLED') AND (
     NEW.premise IS DISTINCT FROM OLD.premise OR NEW.master_synopsis IS DISTINCT FROM OLD.master_synopsis OR
     NEW.intended_ending IS DISTINCT FROM OLD.intended_ending OR NEW.genre_adapter_type IS DISTINCT FROM OLD.genre_adapter_type OR
     NEW.genre_data IS DISTINCT FROM OLD.genre_data OR NEW.major_reveals IS DISTINCT FROM OLD.major_reveals OR
     NEW.twist_alternatives IS DISTINCT FROM OLD.twist_alternatives OR NEW.version IS DISTINCT FROM OLD.version OR
     NEW.book_id IS DISTINCT FROM OLD.book_id) THEN
    RAISE EXCEPTION 'Approved master plans are immutable; create a new version.';
  END IF;
  IF OLD.status IN ('SUPERSEDED','CANCELLED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Master plan status % is terminal.', OLD.status;
  END IF;
  IF OLD.status = 'APPROVED' AND NEW.status NOT IN ('APPROVED','SUPERSEDED','CANCELLED') THEN
    RAISE EXCEPTION 'Invalid master plan transition % -> %', OLD.status, NEW.status;
  END IF;
  IF NEW.status = 'APPROVED' AND OLD.status <> 'APPROVED' THEN NEW.approved_at := now(); END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_protect_master_plan_immutability BEFORE UPDATE ON public.book_master_plans
  FOR EACH ROW EXECUTE FUNCTION public.protect_master_plan_immutability();

CREATE OR REPLACE FUNCTION public.protect_progressive_plan_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.plan_status IN ('READY','SUPERSEDED','CANCELLED') AND (
     NEW.content IS DISTINCT FROM OLD.content OR NEW.dependencies IS DISTINCT FROM OLD.dependencies OR
     NEW.plan_level IS DISTINCT FROM OLD.plan_level OR NEW.chapter_index IS DISTINCT FROM OLD.chapter_index OR
     NEW.subsection_index IS DISTINCT FROM OLD.subsection_index OR NEW.master_plan_id IS DISTINCT FROM OLD.master_plan_id OR
     NEW.parent_plan_id IS DISTINCT FROM OLD.parent_plan_id OR NEW.version IS DISTINCT FROM OLD.version OR
     NEW.book_id IS DISTINCT FROM OLD.book_id) THEN
    RAISE EXCEPTION 'Ready progressive plans are immutable; create a new version.';
  END IF;
  IF OLD.plan_status IN ('SUPERSEDED','CANCELLED') AND NEW.plan_status IS DISTINCT FROM OLD.plan_status THEN
    RAISE EXCEPTION 'Plan status % is terminal.', OLD.plan_status;
  END IF;
  IF OLD.plan_status = 'READY' AND NEW.plan_status = 'PLANNED' THEN
    RAISE EXCEPTION 'Invalid plan transition READY -> PLANNED';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_protect_progressive_plan_immutability BEFORE UPDATE ON public.book_progressive_plans
  FOR EACH ROW EXECUTE FUNCTION public.protect_progressive_plan_immutability();

CREATE TRIGGER trg_book_section_acceptances_updated BEFORE UPDATE ON public.book_section_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT ON public.book_master_plans TO authenticated;
GRANT ALL ON public.book_master_plans TO service_role;
GRANT SELECT ON public.book_progressive_plans TO authenticated;
GRANT ALL ON public.book_progressive_plans TO service_role;
GRANT SELECT ON public.book_section_acceptances TO authenticated;
GRANT ALL ON public.book_section_acceptances TO service_role;

ALTER TABLE public.book_master_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_progressive_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_section_acceptances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read master plans" ON public.book_master_plans FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owners read progressive plans" ON public.book_progressive_plans FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owners read section acceptances" ON public.book_section_acceptances FOR SELECT TO authenticated USING (auth.uid() = user_id);