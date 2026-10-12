ALTER TABLE public.personas ADD COLUMN IF NOT EXISTS portrait_path text;
ALTER TABLE public.fictional_universes ADD COLUMN IF NOT EXISTS locations jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Remember the title of a deleted book on characters that came from it.
CREATE OR REPLACE FUNCTION public.remember_deleted_book_on_identities()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.narrative_identities ni
     SET seed_details = coalesce(ni.seed_details, '{}'::jsonb) || jsonb_build_object('deleted_book_title', OLD.title, 'deleted_book_id', OLD.id)
   WHERE ni.user_id = OLD.user_id
     AND (ni.origin_book_id = OLD.id
          OR ni.id IN (SELECT sc.narrative_identity_id FROM public.story_characters sc WHERE sc.book_id = OLD.id AND sc.narrative_identity_id IS NOT NULL));
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_remember_deleted_book ON public.books;
CREATE TRIGGER trg_remember_deleted_book BEFORE DELETE ON public.books
FOR EACH ROW EXECUTE FUNCTION public.remember_deleted_book_on_identities();

CREATE POLICY "Owners read own portraits" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'persona-portraits' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Owners upload own portraits" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'persona-portraits' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Owners update own portraits" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'persona-portraits' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Owners delete own portraits" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'persona-portraits' AND (storage.foldername(name))[1] = auth.uid()::text);