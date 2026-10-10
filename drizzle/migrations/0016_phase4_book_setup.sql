-- Phase 4: approved Book Setup decisions are stored apart from prose; extra book roles; review deferral.
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS story_setup jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.books.story_setup IS 'Phase 4 Book Setup decisions (planning direction, never canon). Written only by plan-book.';

ALTER TABLE public.book_identity_roles DROP CONSTRAINT IF EXISTS book_identity_roles_narrative_role_check;
ALTER TABLE public.book_identity_roles ADD CONSTRAINT book_identity_roles_narrative_role_check CHECK (narrative_role IN
  ('protagonist','antagonist','primary_narrator','deuteragonist','mentor','foil','love_interest','catalyst','supporting','minor','ally','rival','viewpoint'));

ALTER TABLE public.knowledge_identity_reviews ADD COLUMN IF NOT EXISTS deferred_at timestamptz;
ALTER TABLE public.knowledge_identity_reviews ADD COLUMN IF NOT EXISTS resolution_note text;

-- Browser may not write story_setup directly (server validates it).
CREATE OR REPLACE FUNCTION public.protect_story_setup()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.story_setup IS DISTINCT FROM OLD.story_setup AND COALESCE(auth.role(), '') = 'authenticated' THEN
    RAISE EXCEPTION 'STORY_SETUP_SERVER_ONLY' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS books_protect_story_setup ON public.books;
CREATE TRIGGER books_protect_story_setup BEFORE UPDATE OF story_setup ON public.books
  FOR EACH ROW EXECUTE FUNCTION public.protect_story_setup();