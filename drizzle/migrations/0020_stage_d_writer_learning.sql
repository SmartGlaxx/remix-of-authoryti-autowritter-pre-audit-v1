CREATE TABLE public.writer_learning_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  writer_id text NOT NULL,
  book_id uuid REFERENCES public.books(id) ON DELETE SET NULL,
  genre text,
  category text NOT NULL,
  kind text NOT NULL,
  weight numeric NOT NULL DEFAULT 1,
  chapter_index integer,
  subsection_index integer,
  source_ref text NOT NULL,
  content_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_ref, category, kind)
);
GRANT SELECT ON public.writer_learning_signals TO authenticated;
GRANT ALL ON public.writer_learning_signals TO service_role;
ALTER TABLE public.writer_learning_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read own learning signals" ON public.writer_learning_signals FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX writer_learning_signals_user_writer ON public.writer_learning_signals (user_id, writer_id, category);

ALTER TABLE public.writer_style_adaptations
  ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS confidence numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'writer',
  ADD COLUMN IF NOT EXISTS genre text,
  ADD COLUMN IF NOT EXISTS source_writer_id text,
  ADD COLUMN IF NOT EXISTS parent_id uuid,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE OR REPLACE FUNCTION public.protect_style_adaptation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'reverted' THEN RAISE EXCEPTION 'ADAPTATION_REVERTED_IMMUTABLE'; END IF;
  IF NEW.user_id <> OLD.user_id OR NEW.writer_id <> OLD.writer_id THEN RAISE EXCEPTION 'ADAPTATION_OWNER_IMMUTABLE'; END IF;
  IF OLD.status = 'active' AND (NEW.adjustment IS DISTINCT FROM OLD.adjustment OR NEW.dimension IS DISTINCT FROM OLD.dimension OR NEW.version <> OLD.version) THEN
    RAISE EXCEPTION 'ADAPTATION_ACTIVE_FROZEN';
  END IF;
  IF NOT ((OLD.status = NEW.status) OR (OLD.status = 'proposed' AND NEW.status IN ('active','reverted')) OR (OLD.status = 'active' AND NEW.status = 'reverted')) THEN
    RAISE EXCEPTION 'ADAPTATION_INVALID_TRANSITION';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_style_adaptation ON public.writer_style_adaptations;
CREATE TRIGGER protect_style_adaptation BEFORE UPDATE ON public.writer_style_adaptations FOR EACH ROW EXECUTE FUNCTION public.protect_style_adaptation();