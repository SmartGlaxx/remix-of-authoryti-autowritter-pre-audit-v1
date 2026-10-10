-- Phase 1: Persona Studio foundations, stable identities, universe-scoped canon, chronology, temporal knowledge.
-- Additive only. Standard writing paths do not read any of these columns.

-- 1. Pen names (publishing identities) — never a fictional persona.
CREATE TABLE public.author_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  pen_name text NOT NULL CHECK (length(btrim(pen_name)) > 0),
  bio text,
  genres text[] NOT NULL DEFAULT '{}',
  website text,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.author_identities TO authenticated;
GRANT ALL ON public.author_identities TO service_role;
ALTER TABLE public.author_identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage pen names" ON public.author_identities FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 2. Shared fictional universes.
CREATE TABLE public.fictional_universes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  genre text,
  chronology_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fictional_universes TO authenticated;
GRANT ALL ON public.fictional_universes TO service_role;
ALTER TABLE public.fictional_universes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage universes" ON public.fictional_universes FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 3. Stable identity root for every character level (seed .. independent persona).
CREATE TABLE public.narrative_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  universe_id uuid,
  origin_book_id uuid REFERENCES public.books(id) ON DELETE SET NULL,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  aliases text[] NOT NULL DEFAULT '{}',
  kind text NOT NULL DEFAULT 'person' CHECK (kind IN ('person','group','other')),
  level text NOT NULL DEFAULT 'story_character'
    CHECK (level IN ('seed','mentioned','story_character','major_character','independent_persona')),
  seed_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  merged_into_id uuid REFERENCES public.narrative_identities(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  FOREIGN KEY (universe_id, user_id) REFERENCES public.fictional_universes(id, user_id) ON DELETE RESTRICT
);
CREATE INDEX narrative_identities_user_universe_idx ON public.narrative_identities(user_id, universe_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.narrative_identities TO authenticated;
GRANT ALL ON public.narrative_identities TO service_role;
ALTER TABLE public.narrative_identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage identities" ON public.narrative_identities FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 4. Persona Studio profile, attached 1:1 to a stable identity (promotion never changes ids).
CREATE TABLE public.personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  identity_id uuid NOT NULL UNIQUE,
  category text NOT NULL DEFAULT 'custom',
  creation_mode text NOT NULL DEFAULT 'manual' CHECK (creation_mode IN ('ai','manual','hybrid','promoted')),
  birth_date jsonb,
  death_date jsonb,
  psychology jsonb NOT NULL DEFAULT '{}'::jsonb,
  voice_sample text,
  user_facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_expansions jsonb NOT NULL DEFAULT '[]'::jsonb,
  milestones jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (identity_id, user_id) REFERENCES public.narrative_identities(id, user_id) ON DELETE RESTRICT
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.personas TO authenticated;
GRANT ALL ON public.personas TO service_role;
ALTER TABLE public.personas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage personas" ON public.personas FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 5. Relationships between any identity levels.
CREATE TABLE public.narrative_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  universe_id uuid,
  subject_identity_id uuid NOT NULL,
  target_identity_id uuid NOT NULL,
  relationship_type text NOT NULL CHECK (length(btrim(relationship_type)) > 0),
  emotional_quality text,
  status text,
  established_date jsonb,
  ended_date jsonb,
  shared_secrets text[] NOT NULL DEFAULT '{}',
  is_symmetrical boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (subject_identity_id <> target_identity_id),
  FOREIGN KEY (subject_identity_id, user_id) REFERENCES public.narrative_identities(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (target_identity_id, user_id) REFERENCES public.narrative_identities(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (universe_id, user_id) REFERENCES public.fictional_universes(id, user_id) ON DELETE CASCADE
);
CREATE INDEX narrative_relationships_subject_idx ON public.narrative_relationships(subject_identity_id);
CREATE INDEX narrative_relationships_target_idx ON public.narrative_relationships(target_identity_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.narrative_relationships TO authenticated;
GRANT ALL ON public.narrative_relationships TO service_role;
ALTER TABLE public.narrative_relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage relationships" ON public.narrative_relationships FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Universe isolation: both endpoints must live in the relationship's universe (or all unscoped).
CREATE OR REPLACE FUNCTION public.enforce_relationship_universe()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s_u uuid; t_u uuid;
BEGIN
  SELECT universe_id INTO s_u FROM public.narrative_identities WHERE id = NEW.subject_identity_id;
  SELECT universe_id INTO t_u FROM public.narrative_identities WHERE id = NEW.target_identity_id;
  IF s_u IS DISTINCT FROM t_u THEN
    RAISE EXCEPTION 'RELATIONSHIP_UNIVERSE_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.universe_id IS DISTINCT FROM s_u THEN
    RAISE EXCEPTION 'RELATIONSHIP_UNIVERSE_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER narrative_relationships_universe BEFORE INSERT OR UPDATE ON public.narrative_relationships
  FOR EACH ROW EXECUTE FUNCTION public.enforce_relationship_universe();

-- An identity cannot leave its universe once it has relationships (prevents silent cross-universe mixing).
CREATE OR REPLACE FUNCTION public.protect_identity_universe()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.universe_id IS DISTINCT FROM OLD.universe_id AND EXISTS (
    SELECT 1 FROM public.narrative_relationships
    WHERE subject_identity_id = OLD.id OR target_identity_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'IDENTITY_UNIVERSE_LOCKED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER narrative_identities_universe_lock BEFORE UPDATE ON public.narrative_identities
  FOR EACH ROW EXECUTE FUNCTION public.protect_identity_universe();

-- 6. Temporal knowledge acquisition (who learned what, when, how, how sure). Server-written.
CREATE TABLE public.knowledge_acquisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  identity_id uuid NOT NULL,
  universe_id uuid,
  book_id uuid REFERENCES public.books(id) ON DELETE CASCADE,
  fact_id uuid REFERENCES public.canonical_facts(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.narrative_events(id) ON DELETE CASCADE,
  claim text NOT NULL,
  learned_date jsonb,
  learned_chapter_index integer,
  learned_subsection_index integer,
  source text NOT NULL CHECK (source IN ('direct_witness','testimony','deduction','document','misinformation','false_memory','author_established')),
  source_identity_id uuid,
  certainty text NOT NULL CHECK (certainty IN ('certain','suspected','disputed','false_belief')),
  superseded_date jsonb,
  superseded_chapter_index integer,
  superseded_by uuid REFERENCES public.knowledge_acquisitions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (identity_id, user_id) REFERENCES public.narrative_identities(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (universe_id, user_id) REFERENCES public.fictional_universes(id, user_id) ON DELETE CASCADE
);
CREATE INDEX knowledge_acquisitions_identity_idx ON public.knowledge_acquisitions(identity_id);
GRANT SELECT ON public.knowledge_acquisitions TO authenticated;
GRANT ALL ON public.knowledge_acquisitions TO service_role;
ALTER TABLE public.knowledge_acquisitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read knowledge" ON public.knowledge_acquisitions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 7. Additive links on existing tables.
ALTER TABLE public.books
  ADD COLUMN author_identity_id uuid REFERENCES public.author_identities(id) ON DELETE SET NULL,
  ADD COLUMN universe_id uuid REFERENCES public.fictional_universes(id) ON DELETE SET NULL,
  ADD COLUMN narrator_identity_id uuid REFERENCES public.narrative_identities(id) ON DELETE SET NULL,
  ADD COLUMN narrative_vantage text NOT NULL DEFAULT 'immediate' CHECK (narrative_vantage IN ('immediate','retrospective')),
  ADD COLUMN narrator_telling_date jsonb;

ALTER TABLE public.story_characters ADD COLUMN narrative_identity_id uuid REFERENCES public.narrative_identities(id) ON DELETE SET NULL;
ALTER TABLE public.identity_entities ADD COLUMN narrative_identity_id uuid REFERENCES public.narrative_identities(id) ON DELETE SET NULL;

ALTER TABLE public.canonical_facts
  ADD COLUMN universe_id uuid REFERENCES public.fictional_universes(id) ON DELETE SET NULL,
  ADD COLUMN occurrence_date jsonb;
ALTER TABLE public.narrative_events ADD COLUMN occurrence_date jsonb;
ALTER TABLE public.story_timeline ADD COLUMN approximate_date jsonb;

-- Ownership integrity for book links + narrative vantage locked once prose exists.
CREATE OR REPLACE FUNCTION public.enforce_book_identity_links()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.author_identity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.author_identities WHERE id = NEW.author_identity_id AND user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'PEN_NAME_NOT_OWNED' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.universe_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fictional_universes WHERE id = NEW.universe_id AND user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'UNIVERSE_NOT_OWNED' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.narrator_identity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.narrative_identities WHERE id = NEW.narrator_identity_id AND user_id = NEW.user_id
      AND universe_id IS NOT DISTINCT FROM NEW.universe_id) THEN
    RAISE EXCEPTION 'NARRATOR_NOT_IN_BOOK_UNIVERSE' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.narrative_vantage IS DISTINCT FROM OLD.narrative_vantage
     AND COALESCE(OLD.word_count, 0) > 0 THEN
    RAISE EXCEPTION 'NARRATIVE_VANTAGE_LOCKED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER books_identity_links BEFORE INSERT OR UPDATE OF author_identity_id, universe_id, narrator_identity_id, narrative_vantage
  ON public.books FOR EACH ROW EXECUTE FUNCTION public.enforce_book_identity_links();

-- Universe canon: only the server (from accepted, extracted prose) may scope a fact to a universe,
-- and only to the book's own universe.
CREATE OR REPLACE FUNCTION public.enforce_universe_canon()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE b_u uuid;
BEGIN
  IF NEW.universe_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.universe_id IS NOT DISTINCT FROM OLD.universe_id THEN RETURN NEW; END IF;
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'UNIVERSE_CANON_SERVER_ONLY' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT universe_id INTO b_u FROM public.books WHERE id = NEW.book_id;
  IF b_u IS DISTINCT FROM NEW.universe_id THEN
    RAISE EXCEPTION 'UNIVERSE_CANON_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.canon_status <> 'ESTABLISHED' THEN
    RAISE EXCEPTION 'UNIVERSE_CANON_NOT_ESTABLISHED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER canonical_facts_universe BEFORE INSERT OR UPDATE OF universe_id ON public.canonical_facts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_universe_canon();

-- updated_at maintenance
CREATE TRIGGER author_identities_updated BEFORE UPDATE ON public.author_identities FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER fictional_universes_updated BEFORE UPDATE ON public.fictional_universes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER narrative_identities_updated BEFORE UPDATE ON public.narrative_identities FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER personas_updated BEFORE UPDATE ON public.personas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER narrative_relationships_updated BEFORE UPDATE ON public.narrative_relationships FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
