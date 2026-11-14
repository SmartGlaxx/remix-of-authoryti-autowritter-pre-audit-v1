CREATE TABLE public.page_designs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  page_key text NOT NULL CHECK (char_length(page_key) BETWEEN 1 AND 120),
  spec jsonb NOT NULL,
  generated_spec jsonb,
  schema_version int NOT NULL DEFAULT 2,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, page_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.page_designs TO authenticated;
GRANT ALL ON public.page_designs TO service_role;
ALTER TABLE public.page_designs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read page designs" ON public.page_designs FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND b.user_id = auth.uid()));
CREATE POLICY "Owners insert page designs" ON public.page_designs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND b.user_id = auth.uid()));
CREATE POLICY "Owners update page designs" ON public.page_designs FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND b.user_id = auth.uid()));
CREATE POLICY "Owners delete page designs" ON public.page_designs FOR DELETE TO authenticated
  USING (user_id = auth.uid());
CREATE INDEX page_designs_book_idx ON public.page_designs(book_id);
CREATE OR REPLACE FUNCTION public.touch_page_designs() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER page_designs_touch BEFORE UPDATE ON public.page_designs FOR EACH ROW EXECUTE FUNCTION public.touch_page_designs();