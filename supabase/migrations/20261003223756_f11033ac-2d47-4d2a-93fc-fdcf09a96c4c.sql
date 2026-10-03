CREATE TABLE public.saved_book_ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  subtitle text NOT NULL DEFAULT '' CHECK (char_length(subtitle) <= 160),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1200),
  book_type text NOT NULL,
  genre text NOT NULL DEFAULT '',
  audience text NOT NULL DEFAULT 'general-readers',
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_book_ideas TO authenticated;
GRANT ALL ON public.saved_book_ideas TO service_role;
ALTER TABLE public.saved_book_ideas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own saved ideas" ON public.saved_book_ideas FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX saved_book_ideas_user_idx ON public.saved_book_ideas(user_id, created_at DESC);
CREATE TRIGGER update_saved_book_ideas_updated_at BEFORE UPDATE ON public.saved_book_ideas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();