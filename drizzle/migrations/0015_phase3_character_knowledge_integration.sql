-- Phase 3: knowledge extracted from accepted prose, idempotent per section text, with rollback keys.
ALTER TABLE public.knowledge_acquisitions
  ADD COLUMN IF NOT EXISTS extraction_id uuid,
  ADD COLUMN IF NOT EXISTS source_section_key text,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS knowledge_kind text CHECK (knowledge_kind IS NULL OR knowledge_kind IN ('knows','believes','suspects','misunderstands','conceals')),
  ADD COLUMN IF NOT EXISTS truth_status text CHECK (truth_status IS NULL OR truth_status IN ('true','false','disputed','unverified')),
  ADD COLUMN IF NOT EXISTS evidence text,
  ADD COLUMN IF NOT EXISTS scene_point jsonb,
  ADD COLUMN IF NOT EXISTS dedup_key text;
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_acquisitions_dedup_key_idx ON public.knowledge_acquisitions(dedup_key);
CREATE INDEX IF NOT EXISTS knowledge_acquisitions_book_section_idx ON public.knowledge_acquisitions(book_id, source_section_key);

-- Knowledge whose holder could not be resolved to exactly one stable identity. Never guessed.
CREATE TABLE public.knowledge_identity_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  source_section_key text NOT NULL,
  content_hash text NOT NULL,
  character_name text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('ambiguous','no_identity')),
  candidate_identity_ids uuid[] NOT NULL DEFAULT '{}',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RESOLVED','DISMISSED')),
  resolved_identity_id uuid,
  dedup_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_identity_reviews_book_idx ON public.knowledge_identity_reviews(book_id, status);
GRANT SELECT ON public.knowledge_identity_reviews TO authenticated;
GRANT ALL ON public.knowledge_identity_reviews TO service_role;
ALTER TABLE public.knowledge_identity_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read knowledge reviews" ON public.knowledge_identity_reviews FOR SELECT TO authenticated
  USING (user_id = auth.uid());