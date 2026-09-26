
-- Helper: position ordering key
CREATE OR REPLACE FUNCTION public.story_position(_ch integer, _sub integer)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public
AS $$ SELECT COALESCE(_ch,0) * 10000 + COALESCE(_sub,0) $$;

-- 1. Characters registry (stable IDs linking to static outline profiles)
CREATE TABLE public.story_characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  source_key text,               -- outline.characters[].id
  name text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  role text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_story_characters_source_key ON public.story_characters(book_id, source_key) WHERE source_key IS NOT NULL;
CREATE INDEX idx_story_characters_book ON public.story_characters(book_id);

-- 2. Entities
CREATE TABLE public.story_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  source_key text,
  entity_type text NOT NULL CHECK (entity_type IN ('location','organization','object','faction','other')),
  name text NOT NULL,
  description text,
  aliases text[] NOT NULL DEFAULT '{}',
  attributes jsonb NOT NULL DEFAULT '{}',
  first_chapter_index integer,
  first_subsection_index integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_story_entities_source_key ON public.story_entities(book_id, source_key) WHERE source_key IS NOT NULL;
CREATE INDEX idx_story_entities_book_type ON public.story_entities(book_id, entity_type);

-- 3. Character states (temporal, versioned)
CREATE TABLE public.character_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  character_id uuid NOT NULL REFERENCES public.story_characters(id) ON DELETE CASCADE,
  chapter_index integer NOT NULL,
  subsection_index integer NOT NULL DEFAULT 0,
  position integer GENERATED ALWAYS AS (chapter_index * 10000 + subsection_index) STORED,
  location_entity_id uuid REFERENCES public.story_entities(id) ON DELETE SET NULL,
  location_text text,
  physical_condition text,
  emotional_state text,
  current_goals text[] NOT NULL DEFAULT '{}',
  current_motivations text,
  knowledge text[] NOT NULL DEFAULT '{}',
  beliefs jsonb NOT NULL DEFAULT '{}',
  secrets_known text[] NOT NULL DEFAULT '{}',
  relationships jsonb NOT NULL DEFAULT '{}',
  inventory text[] NOT NULL DEFAULT '{}',
  key_changes text,
  authority text NOT NULL DEFAULT 'AI_INFERENCE' CHECK (authority IN ('USER_CANON','OUTLINE_CANON','APPROVED_GENERATED_STATE','AI_INFERENCE')),
  version integer NOT NULL DEFAULT 1,
  is_current boolean NOT NULL DEFAULT true,
  superseded_by uuid REFERENCES public.character_states(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_character_states_lookup ON public.character_states(book_id, character_id, position DESC);

-- 4. Events
CREATE TABLE public.narrative_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  chapter_index integer NOT NULL,
  subsection_index integer NOT NULL DEFAULT 0,
  position integer GENERATED ALWAYS AS (chapter_index * 10000 + subsection_index) STORED,
  chronological_order numeric,
  title text NOT NULL,
  summary text NOT NULL,
  location_entity_id uuid REFERENCES public.story_entities(id) ON DELETE SET NULL,
  location_text text,
  causes text[] NOT NULL DEFAULT '{}',
  consequences text[] NOT NULL DEFAULT '{}',
  information_revealed text[] NOT NULL DEFAULT '{}',
  information_withheld text[] NOT NULL DEFAULT '{}',
  is_canonical boolean NOT NULL DEFAULT true,
  authority text NOT NULL DEFAULT 'AI_INFERENCE' CHECK (authority IN ('USER_CANON','OUTLINE_CANON','APPROVED_GENERATED_STATE','AI_INFERENCE')),
  source_subsection_id text,
  prose_excerpt text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_narrative_events_book_pos ON public.narrative_events(book_id, position);

CREATE TABLE public.event_participants (
  event_id uuid NOT NULL REFERENCES public.narrative_events(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES public.story_characters(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  participation_role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, character_id)
);
CREATE INDEX idx_event_participants_character ON public.event_participants(character_id);

-- 5. Plot threads
CREATE TABLE public.plot_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  source_key text,
  title text NOT NULL,
  description text,
  introduced_chapter_index integer,
  introduced_subsection_index integer,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DEVELOPING','RESOLVED','ABANDONED','SUPERSEDED')),
  importance text NOT NULL DEFAULT 'major' CHECK (importance IN ('major','minor')),
  clues text[] NOT NULL DEFAULT '{}',
  setup_promise text,
  required_resolution text,
  resolution_event_id uuid REFERENCES public.narrative_events(id) ON DELETE SET NULL,
  resolved_chapter_index integer,
  resolution_notes text,
  superseded_by uuid REFERENCES public.plot_threads(id) ON DELETE SET NULL,
  unresolved_questions text[] NOT NULL DEFAULT '{}',
  authority text NOT NULL DEFAULT 'AI_INFERENCE' CHECK (authority IN ('USER_CANON','OUTLINE_CANON','APPROVED_GENERATED_STATE','AI_INFERENCE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plot_thread_resolution_required CHECK (
    status <> 'RESOLVED' OR (resolution_notes IS NOT NULL AND length(btrim(resolution_notes)) > 0 AND resolved_chapter_index IS NOT NULL)
  ),
  CONSTRAINT plot_thread_abandon_reason CHECK (
    status NOT IN ('ABANDONED','SUPERSEDED') OR (resolution_notes IS NOT NULL AND length(btrim(resolution_notes)) > 0)
  )
);
CREATE UNIQUE INDEX idx_plot_threads_source_key ON public.plot_threads(book_id, source_key) WHERE source_key IS NOT NULL;
CREATE INDEX idx_plot_threads_book_status ON public.plot_threads(book_id, status);

CREATE TABLE public.plot_thread_events (
  thread_id uuid NOT NULL REFERENCES public.plot_threads(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.narrative_events(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  relation text NOT NULL DEFAULT 'develops' CHECK (relation IN ('introduces','develops','clue','complicates','resolves')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, event_id)
);
CREATE TABLE public.plot_thread_characters (
  thread_id uuid NOT NULL REFERENCES public.plot_threads(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES public.story_characters(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, character_id)
);

-- 6. Canonical facts
CREATE TABLE public.canonical_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  subject text NOT NULL,
  subject_character_id uuid REFERENCES public.story_characters(id) ON DELETE SET NULL,
  subject_entity_id uuid REFERENCES public.story_entities(id) ON DELETE SET NULL,
  predicate text NOT NULL,
  value text NOT NULL,
  category text NOT NULL DEFAULT 'general' CHECK (category IN ('character','world','plot','timeline','general')),
  authority text NOT NULL DEFAULT 'AI_INFERENCE' CHECK (authority IN ('USER_CANON','OUTLINE_CANON','APPROVED_GENERATED_STATE','AI_INFERENCE')),
  source_type text NOT NULL DEFAULT 'generated_prose' CHECK (source_type IN ('user','outline','generated_prose','extraction','other')),
  source_chapter_index integer,
  source_subsection_index integer,
  source_excerpt text,
  confidence numeric NOT NULL DEFAULT 0.7 CHECK (confidence >= 0 AND confidence <= 1),
  is_canonical boolean NOT NULL DEFAULT true,
  conflict_status text NOT NULL DEFAULT 'clean' CHECK (conflict_status IN ('clean','disputed','rejected','superseded')),
  conflicting_fact_id uuid REFERENCES public.canonical_facts(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_canonical_facts_key ON public.canonical_facts(book_id, lower(subject), lower(predicate));
CREATE INDEX idx_canonical_facts_conflicts ON public.canonical_facts(book_id, conflict_status);

-- 7. Timeline
CREATE TABLE public.story_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  event_id uuid REFERENCES public.narrative_events(id) ON DELETE SET NULL,
  story_date text,
  story_time text,
  relative_order numeric NOT NULL,
  chapter_index integer,
  subsection_index integer,
  location_entity_id uuid REFERENCES public.story_entities(id) ON DELETE SET NULL,
  location_text text,
  participant_ids uuid[] NOT NULL DEFAULT '{}',
  event_summary text NOT NULL,
  duration text,
  is_flashback boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_story_timeline_order ON public.story_timeline(book_id, relative_order);

-- 8. Snapshots
CREATE TABLE public.story_state_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  chapter_index integer NOT NULL,
  subsection_index integer NOT NULL DEFAULT 0,
  scope text NOT NULL DEFAULT 'subsection' CHECK (scope IN ('subsection','chapter')),
  narrative_summary text,
  timeline_position numeric,
  state jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, chapter_index, subsection_index, scope)
);

-- Grants, RLS, triggers
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['story_characters','story_entities','character_states','narrative_events','event_participants','plot_threads','plot_thread_events','plot_thread_characters','canonical_facts','story_timeline','story_state_snapshots']
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY "Owners manage own rows" ON public.%I FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND b.user_id = auth.uid()))$p$, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['story_characters','story_entities','character_states','narrative_events','plot_threads','canonical_facts','story_timeline','story_state_snapshots']
  LOOP
    EXECUTE format('CREATE TRIGGER update_%s_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t, t);
  END LOOP;
END $$;
