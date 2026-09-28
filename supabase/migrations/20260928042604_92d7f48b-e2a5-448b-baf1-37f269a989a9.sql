CREATE TABLE public.manuscript_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  cache_key text NOT NULL,
  manuscript_hash text NOT NULL,
  outline_hash text NOT NULL,
  narrative_state_version text NOT NULL,
  word_count integer NOT NULL DEFAULT 0,
  chapter_count integer NOT NULL DEFAULT 0,
  section_count integer NOT NULL DEFAULT 0,
  model_identifier text,
  status text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('NOT_RUN','RUNNING','PARTIAL','COMPLETE','FAILED')),
  stage_progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX idx_manuscript_audits_book ON public.manuscript_audits(book_id, created_at DESC);
CREATE INDEX idx_manuscript_audits_cache ON public.manuscript_audits(book_id, cache_key);
GRANT SELECT ON public.manuscript_audits TO authenticated;
GRANT ALL ON public.manuscript_audits TO service_role;
ALTER TABLE public.manuscript_audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners view their audits" ON public.manuscript_audits FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER update_manuscript_audits_updated_at BEFORE UPDATE ON public.manuscript_audits FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.manuscript_audit_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.manuscript_audits(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('structural','plot_thread','character_arc','character_knowledge','timeline','canonical_fact','continuity_history','promise_payoff','nonfiction_consistency','redundancy')),
  severity text NOT NULL CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  confidence numeric NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  verification text NOT NULL DEFAULT 'VERIFIED' CHECK (verification IN ('VERIFIED','UNCERTAIN')),
  title text NOT NULL,
  concise_description text NOT NULL DEFAULT '',
  evidence_excerpt text,
  evidence_location jsonb,
  contradicting_evidence text,
  contradicting_location jsonb,
  related_fact_ids uuid[] NOT NULL DEFAULT '{}',
  related_event_ids uuid[] NOT NULL DEFAULT '{}',
  related_character_ids uuid[] NOT NULL DEFAULT '{}',
  related_plot_thread_ids uuid[] NOT NULL DEFAULT '{}',
  related_continuity_check_ids uuid[] NOT NULL DEFAULT '{}',
  user_canon_protected boolean NOT NULL DEFAULT false,
  explanation text,
  suggested_action text,
  auto_fixable boolean NOT NULL DEFAULT false CHECK (auto_fixable = false),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED_BY_USER','DISMISSED')),
  user_notes text,
  dedup_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_id, dedup_key)
);
CREATE INDEX idx_audit_findings_audit ON public.manuscript_audit_findings(audit_id);
GRANT SELECT ON public.manuscript_audit_findings TO authenticated;
GRANT UPDATE (status, user_notes) ON public.manuscript_audit_findings TO authenticated;
GRANT ALL ON public.manuscript_audit_findings TO service_role;
ALTER TABLE public.manuscript_audit_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners view their findings" ON public.manuscript_audit_findings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owners update their finding status" ON public.manuscript_audit_findings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_manuscript_audit_findings_updated_at BEFORE UPDATE ON public.manuscript_audit_findings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();