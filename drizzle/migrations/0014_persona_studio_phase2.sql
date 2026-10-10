-- Phase 2: creation of identities, personas and relationships goes through the server
-- (authoritative identity resolution). Owners keep read/update/delete.
REVOKE INSERT ON public.narrative_identities FROM authenticated;
REVOKE INSERT ON public.personas FROM authenticated;
REVOKE INSERT ON public.narrative_relationships FROM authenticated;

-- Book-specific narrative role (separate from the persona's enduring domain category).
CREATE TABLE public.book_identity_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  identity_id uuid NOT NULL,
  narrative_role text NOT NULL CHECK (narrative_role IN ('protagonist','antagonist','primary_narrator','deuteragonist','mentor','foil','love_interest','catalyst','supporting','minor')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, identity_id),
  FOREIGN KEY (identity_id, user_id) REFERENCES public.narrative_identities(id, user_id) ON DELETE CASCADE
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.book_identity_roles TO authenticated;
GRANT ALL ON public.book_identity_roles TO service_role;
ALTER TABLE public.book_identity_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage book roles" ON public.book_identity_roles FOR ALL TO authenticated
  USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND b.user_id = auth.uid()))
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND b.user_id = auth.uid()));
