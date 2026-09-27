CREATE TABLE public.narrative_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  chapter_index integer NOT NULL,
  subsection_index integer NOT NULL,
  subsection_id text,
  content_hash text NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed','failed')),
  attempts integer NOT NULL DEFAULT 0,
  error text,
  applied jsonb NOT NULL DEFAULT '{}',
  model_identifier text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, chapter_index, subsection_index)
);
GRANT SELECT ON public.narrative_extractions TO authenticated;
GRANT ALL ON public.narrative_extractions TO service_role;
ALTER TABLE public.narrative_extractions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read own extractions" ON public.narrative_extractions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER update_narrative_extractions_updated_at BEFORE UPDATE ON public.narrative_extractions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_narrative_extractions_status ON public.narrative_extractions(book_id, status);

ALTER TABLE public.narrative_events ADD COLUMN extraction_id uuid REFERENCES public.narrative_extractions(id) ON DELETE SET NULL;
ALTER TABLE public.character_states ADD COLUMN extraction_id uuid REFERENCES public.narrative_extractions(id) ON DELETE SET NULL;
ALTER TABLE public.canonical_facts ADD COLUMN extraction_id uuid REFERENCES public.narrative_extractions(id) ON DELETE SET NULL;
ALTER TABLE public.plot_threads ADD COLUMN extraction_id uuid REFERENCES public.narrative_extractions(id) ON DELETE SET NULL;
ALTER TABLE public.story_timeline ADD COLUMN extraction_id uuid REFERENCES public.narrative_extractions(id) ON DELETE SET NULL;
ALTER TABLE public.story_characters ADD COLUMN extraction_id uuid REFERENCES public.narrative_extractions(id) ON DELETE SET NULL;
CREATE INDEX idx_narrative_events_extraction ON public.narrative_events(extraction_id) WHERE extraction_id IS NOT NULL;
CREATE INDEX idx_character_states_extraction ON public.character_states(extraction_id) WHERE extraction_id IS NOT NULL;
CREATE INDEX idx_canonical_facts_extraction ON public.canonical_facts(extraction_id) WHERE extraction_id IS NOT NULL;
CREATE INDEX idx_plot_threads_extraction ON public.plot_threads(extraction_id) WHERE extraction_id IS NOT NULL;
CREATE INDEX idx_story_timeline_extraction ON public.story_timeline(extraction_id) WHERE extraction_id IS NOT NULL;