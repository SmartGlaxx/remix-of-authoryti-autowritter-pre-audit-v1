-- Phase G completion + Phase H: recoverable candidate drafts, deferred canon activation,
-- version-aware memory status across all authoritative narrative-memory tables.

-- 1. Canon status on every authoritative memory source (history is never deleted).
ALTER TABLE public.canonical_facts         ADD COLUMN IF NOT EXISTS canon_status text NOT NULL DEFAULT 'ESTABLISHED', ADD COLUMN IF NOT EXISTS canon_flag jsonb;
ALTER TABLE public.character_states        ADD COLUMN IF NOT EXISTS canon_status text NOT NULL DEFAULT 'ESTABLISHED', ADD COLUMN IF NOT EXISTS canon_flag jsonb;
ALTER TABLE public.narrative_events        ADD COLUMN IF NOT EXISTS canon_status text NOT NULL DEFAULT 'ESTABLISHED', ADD COLUMN IF NOT EXISTS canon_flag jsonb;
ALTER TABLE public.story_timeline          ADD COLUMN IF NOT EXISTS canon_status text NOT NULL DEFAULT 'ESTABLISHED', ADD COLUMN IF NOT EXISTS canon_flag jsonb;
ALTER TABLE public.plot_threads            ADD COLUMN IF NOT EXISTS canon_status text NOT NULL DEFAULT 'ESTABLISHED', ADD COLUMN IF NOT EXISTS canon_flag jsonb;
ALTER TABLE public.story_entities          ADD COLUMN IF NOT EXISTS canon_status text NOT NULL DEFAULT 'ESTABLISHED', ADD COLUMN IF NOT EXISTS canon_flag jsonb;
ALTER TABLE public.identity_attribute_versions ADD COLUMN IF NOT EXISTS canon_status text NOT NULL DEFAULT 'ESTABLISHED', ADD COLUMN IF NOT EXISTS canon_flag jsonb;
ALTER TABLE public.narrative_exact_anchors ADD COLUMN IF NOT EXISTS canon_status text NOT NULL DEFAULT 'ESTABLISHED', ADD COLUMN IF NOT EXISTS canon_flag jsonb;
ALTER TABLE public.canonical_facts         ADD CONSTRAINT canonical_facts_canon_status_chk CHECK (canon_status IN ('ESTABLISHED','UNCERTAIN','SUPERSEDED'));
ALTER TABLE public.character_states        ADD CONSTRAINT character_states_canon_status_chk CHECK (canon_status IN ('ESTABLISHED','UNCERTAIN','SUPERSEDED'));
ALTER TABLE public.narrative_events        ADD CONSTRAINT narrative_events_canon_status_chk CHECK (canon_status IN ('ESTABLISHED','UNCERTAIN','SUPERSEDED'));
ALTER TABLE public.story_timeline          ADD CONSTRAINT story_timeline_canon_status_chk CHECK (canon_status IN ('ESTABLISHED','UNCERTAIN','SUPERSEDED'));
ALTER TABLE public.plot_threads            ADD CONSTRAINT plot_threads_canon_status_chk CHECK (canon_status IN ('ESTABLISHED','UNCERTAIN','SUPERSEDED'));
ALTER TABLE public.story_entities          ADD CONSTRAINT story_entities_canon_status_chk CHECK (canon_status IN ('ESTABLISHED','UNCERTAIN','SUPERSEDED'));
ALTER TABLE public.identity_attribute_versions ADD CONSTRAINT identity_attr_canon_status_chk CHECK (canon_status IN ('ESTABLISHED','UNCERTAIN','SUPERSEDED'));
ALTER TABLE public.narrative_exact_anchors ADD CONSTRAINT anchors_canon_status_chk CHECK (canon_status IN ('ESTABLISHED','UNCERTAIN','SUPERSEDED'));

-- 2. Validation cost per run.
ALTER TABLE public.context_engine_runs
  ADD COLUMN IF NOT EXISTS validation_status text,
  ADD COLUMN IF NOT EXISTS validation_rounds integer,
  ADD COLUMN IF NOT EXISTS validation_input_tokens integer,
  ADD COLUMN IF NOT EXISTS validation_output_tokens integer,
  ADD COLUMN IF NOT EXISTS validation_cost_usd numeric;

-- 3. Recoverable candidate drafts: owner read-only; all writes via server functions.
CREATE TABLE public.book_candidate_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  chapter_index integer NOT NULL,
  subsection_index integer NOT NULL,
  master_plan_id uuid,
  draft_text text NOT NULL,
  content_hash text NOT NULL,
  parent_candidate_id uuid REFERENCES public.book_candidate_drafts(id) ON DELETE SET NULL,
  origin text NOT NULL DEFAULT 'generated' CHECK (origin IN ('generated','author_edit','retry')),
  validation_status text NOT NULL CHECK (validation_status IN ('BLOCKED_MATERIAL','NEEDS_AUTHOR_REVIEW','ACCEPTED','DISCARDED','SUPERSEDED')),
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL DEFAULT 1,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, chapter_index, subsection_index, content_hash)
);
GRANT SELECT ON public.book_candidate_drafts TO authenticated;
GRANT ALL ON public.book_candidate_drafts TO service_role;
ALTER TABLE public.book_candidate_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read own candidate drafts" ON public.book_candidate_drafts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX book_candidate_drafts_book_idx ON public.book_candidate_drafts(book_id, chapter_index, subsection_index, created_at DESC);
CREATE TRIGGER book_candidate_drafts_updated_at BEFORE UPDATE ON public.book_candidate_drafts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Reconciliation logs: link to candidate, two-stage canon application.
ALTER TABLE public.canon_reconciliation_logs
  ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.book_candidate_drafts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS application_status text NOT NULL DEFAULT 'NOT_APPLICABLE',
  ADD COLUMN IF NOT EXISTS applied_at timestamptz;
ALTER TABLE public.canon_reconciliation_logs ADD CONSTRAINT recon_application_status_chk
  CHECK (application_status IN ('NOT_APPLICABLE','PENDING_APPLICATION','AWAITING_SYNC','APPLIED','ABANDONED'));

-- Evidence stays immutable and a decision is recorded once; after the decision only the
-- application lifecycle (pending -> awaiting sync -> applied | abandoned) may advance.
CREATE OR REPLACE FUNCTION public.protect_reconciliation_log()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.book_id IS DISTINCT FROM OLD.book_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.description IS DISTINCT FROM OLD.description OR NEW.prose_excerpt IS DISTINCT FROM OLD.prose_excerpt
     OR NEW.canon_reference IS DISTINCT FROM OLD.canon_reference OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.severity IS DISTINCT FROM OLD.severity OR NEW.discrepancy_type IS DISTINCT FROM OLD.discrepancy_type
     OR NEW.chapter_index IS DISTINCT FROM OLD.chapter_index OR NEW.subsection_index IS DISTINCT FROM OLD.subsection_index
     OR NEW.dedup_key IS DISTINCT FROM OLD.dedup_key THEN
    RAISE EXCEPTION 'Reconciliation evidence is immutable.';
  END IF;
  IF OLD.decision <> 'PENDING' THEN
    IF NEW.decision IS DISTINCT FROM OLD.decision OR NEW.rationale IS DISTINCT FROM OLD.rationale
       OR NEW.resulting_changes IS DISTINCT FROM OLD.resulting_changes OR NEW.decided_by IS DISTINCT FROM OLD.decided_by
       OR NEW.decided_at IS DISTINCT FROM OLD.decided_at OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id THEN
      RAISE EXCEPTION 'Reconciliation decision already recorded.';
    END IF;
    IF NEW.application_status IS DISTINCT FROM OLD.application_status AND NOT (
         (OLD.application_status = 'PENDING_APPLICATION' AND NEW.application_status IN ('AWAITING_SYNC','ABANDONED'))
      OR (OLD.application_status = 'AWAITING_SYNC' AND NEW.application_status IN ('APPLIED','PENDING_APPLICATION'))
      OR (OLD.application_status = 'NOT_APPLICABLE' AND NEW.application_status = 'ABANDONED')) THEN
      RAISE EXCEPTION 'Invalid canon application transition % -> %', OLD.application_status, NEW.application_status;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

-- Adopting new canon is recorded as approved-but-pending; authoritative memory is untouched here.
CREATE OR REPLACE FUNCTION public.decide_canon_reconciliation(p_log_id uuid, p_decision text, p_rationale text, p_resulting_changes jsonb DEFAULT '[]'::jsonb, p_replan boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r canon_reconciliation_logs%ROWTYPE; v_uid uuid := auth.uid(); v_app text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_decision NOT IN ('KEEP_CANON_REVISE_PROSE','ACCEPT_PROSE_UPDATE_CANON','DISMISS') THEN RAISE EXCEPTION 'invalid decision'; END IF;
  IF p_rationale IS NULL OR char_length(btrim(p_rationale)) = 0 THEN RAISE EXCEPTION 'rationale required'; END IF;
  SELECT * INTO r FROM canon_reconciliation_logs WHERE id = p_log_id FOR UPDATE;
  IF NOT FOUND OR r.user_id <> v_uid THEN RAISE EXCEPTION 'not found'; END IF;
  IF r.decision <> 'PENDING' THEN RETURN jsonb_build_object('status','already_decided','decision',r.decision); END IF;
  v_app := CASE WHEN p_decision = 'ACCEPT_PROSE_UPDATE_CANON' AND r.candidate_id IS NOT NULL THEN 'PENDING_APPLICATION' ELSE 'NOT_APPLICABLE' END;
  UPDATE canon_reconciliation_logs SET decision=p_decision, rationale=btrim(p_rationale), resulting_changes=coalesce(p_resulting_changes,'[]'::jsonb),
    replan_required=coalesce(p_replan,false) OR p_decision='ACCEPT_PROSE_UPDATE_CANON', decided_by=v_uid, decided_at=now(),
    application_status=v_app WHERE id=p_log_id;
  RETURN jsonb_build_object('status','decided','decision',p_decision,'application_status',v_app);
END $function$;

-- 5. Server-only: store a blocked candidate and link its discrepancy records.
CREATE OR REPLACE FUNCTION public.save_candidate_draft(p_book_id uuid, p_user_id uuid, p_chapter integer, p_sub integer, p_master_plan_id uuid,
  p_text text, p_hash text, p_status text, p_findings jsonb, p_usage jsonb, p_origin text, p_parent uuid, p_dedup_keys text[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_attempt int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM books WHERE id = p_book_id AND user_id = p_user_id) THEN RAISE EXCEPTION 'BOOK_NOT_OWNED'; END IF;
  IF p_status NOT IN ('BLOCKED_MATERIAL','NEEDS_AUTHOR_REVIEW') THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  SELECT id INTO v_id FROM book_candidate_drafts WHERE book_id=p_book_id AND chapter_index=p_chapter AND subsection_index=p_sub AND content_hash=p_hash;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('status','duplicate','candidate_id',v_id); END IF;
  SELECT coalesce(max(attempt_count),0)+1 INTO v_attempt FROM book_candidate_drafts WHERE book_id=p_book_id AND chapter_index=p_chapter AND subsection_index=p_sub;
  UPDATE book_candidate_drafts SET validation_status='SUPERSEDED', resolved_at=now()
   WHERE book_id=p_book_id AND chapter_index=p_chapter AND subsection_index=p_sub AND validation_status IN ('BLOCKED_MATERIAL','NEEDS_AUTHOR_REVIEW');
  INSERT INTO book_candidate_drafts(book_id,user_id,chapter_index,subsection_index,master_plan_id,draft_text,content_hash,parent_candidate_id,origin,validation_status,findings,usage,attempt_count)
   VALUES (p_book_id,p_user_id,p_chapter,p_sub,p_master_plan_id,p_text,p_hash,p_parent,coalesce(p_origin,'generated'),p_status,coalesce(p_findings,'[]'::jsonb),coalesce(p_usage,'{}'::jsonb),v_attempt)
   RETURNING id INTO v_id;
  UPDATE canon_reconciliation_logs SET candidate_id = v_id
   WHERE book_id=p_book_id AND dedup_key = ANY(coalesce(p_dedup_keys,'{}')) AND decision='PENDING' AND candidate_id IS NULL;
  RETURN jsonb_build_object('status','saved','candidate_id',v_id,'attempt',v_attempt);
END $function$;

-- Server-only: version-aware memory flagging. Rows derived from the replaced section become
-- SUPERSEDED, later rows become UNCERTAIN. One transaction; nothing is deleted.
CREATE OR REPLACE FUNCTION public.flag_downstream_memory(p_book_id uuid, p_user_id uuid, p_chapter integer, p_sub integer, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE here int := story_position(p_chapter, p_sub); f jsonb := jsonb_build_object('reason', p_reason, 'source', jsonb_build_array(p_chapter, p_sub), 'at', now());
  n_f int; n_s int; n_e int; n_t int; n_p int; n_en int; n_i int; n_a int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM books WHERE id = p_book_id AND user_id = p_user_id) THEN RAISE EXCEPTION 'BOOK_NOT_OWNED'; END IF;
  UPDATE canonical_facts SET canon_status = CASE WHEN story_position(source_chapter_index, source_subsection_index) = here THEN 'SUPERSEDED' ELSE 'UNCERTAIN' END, canon_flag = f
   WHERE book_id=p_book_id AND canon_status='ESTABLISHED' AND source_chapter_index IS NOT NULL AND story_position(source_chapter_index, source_subsection_index) >= here;
  GET DIAGNOSTICS n_f = ROW_COUNT;
  UPDATE character_states SET canon_status = CASE WHEN story_position(chapter_index, subsection_index) = here THEN 'SUPERSEDED' ELSE 'UNCERTAIN' END, canon_flag = f
   WHERE book_id=p_book_id AND canon_status='ESTABLISHED' AND story_position(chapter_index, subsection_index) >= here;
  GET DIAGNOSTICS n_s = ROW_COUNT;
  UPDATE narrative_events SET canon_status = CASE WHEN story_position(chapter_index, subsection_index) = here THEN 'SUPERSEDED' ELSE 'UNCERTAIN' END, canon_flag = f
   WHERE book_id=p_book_id AND canon_status='ESTABLISHED' AND story_position(chapter_index, subsection_index) >= here;
  GET DIAGNOSTICS n_e = ROW_COUNT;
  UPDATE story_timeline SET canon_status = CASE WHEN story_position(chapter_index, subsection_index) = here THEN 'SUPERSEDED' ELSE 'UNCERTAIN' END, canon_flag = f
   WHERE book_id=p_book_id AND canon_status='ESTABLISHED' AND chapter_index IS NOT NULL AND story_position(chapter_index, subsection_index) >= here;
  GET DIAGNOSTICS n_t = ROW_COUNT;
  UPDATE plot_threads SET canon_status = CASE WHEN story_position(introduced_chapter_index, introduced_subsection_index) = here THEN 'SUPERSEDED' ELSE 'UNCERTAIN' END, canon_flag = f
   WHERE book_id=p_book_id AND canon_status='ESTABLISHED' AND introduced_chapter_index IS NOT NULL AND story_position(introduced_chapter_index, introduced_subsection_index) >= here;
  GET DIAGNOSTICS n_p = ROW_COUNT;
  UPDATE story_entities SET canon_status = CASE WHEN story_position(first_chapter_index, first_subsection_index) = here THEN 'SUPERSEDED' ELSE 'UNCERTAIN' END, canon_flag = f
   WHERE book_id=p_book_id AND canon_status='ESTABLISHED' AND first_chapter_index IS NOT NULL AND story_position(first_chapter_index, first_subsection_index) >= here;
  GET DIAGNOSTICS n_en = ROW_COUNT;
  UPDATE identity_attribute_versions SET canon_status = CASE WHEN effective_position = here THEN 'SUPERSEDED' ELSE 'UNCERTAIN' END, canon_flag = f
   WHERE book_id=p_book_id AND canon_status='ESTABLISHED' AND authority NOT IN ('USER_CANON','OUTLINE_CANON') AND effective_position >= here;
  GET DIAGNOSTICS n_i = ROW_COUNT;
  UPDATE narrative_exact_anchors SET canon_status = 'UNCERTAIN', canon_flag = f
   WHERE book_id=p_book_id AND is_active AND canon_status='ESTABLISHED' AND source_type <> 'author' AND effective_chapter_index > p_chapter;
  GET DIAGNOSTICS n_a = ROW_COUNT;
  RETURN jsonb_build_object('facts',n_f,'states',n_s,'events',n_e,'timeline',n_t,'threads',n_p,'entities',n_en,'identities',n_i,'anchors',n_a);
END $function$;

-- Server-only: accept a candidate. Requires every linked material contradiction to be decided,
-- refuses unrevised text when the author chose to keep canon, then fences + commits the
-- manuscript, moves approved canon changes to AWAITING_SYNC (activated only by extraction),
-- and flags downstream memory when an accepted section is replaced. One transaction.
CREATE OR REPLACE FUNCTION public.commit_candidate_draft(p_candidate_id uuid, p_user_id uuid, p_worker text, p_token bigint, p_text text, p_hash text, p_replace boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c book_candidate_drafts%ROWTYPE; res jsonb; v_flags jsonb := null; v_had_accepted boolean;
BEGIN
  SELECT * INTO c FROM book_candidate_drafts WHERE id = p_candidate_id FOR UPDATE;
  IF NOT FOUND OR c.user_id <> p_user_id THEN RAISE EXCEPTION 'CANDIDATE_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF c.validation_status NOT IN ('BLOCKED_MATERIAL','NEEDS_AUTHOR_REVIEW') THEN RAISE EXCEPTION 'CANDIDATE_NOT_OPEN' USING ERRCODE='P0001'; END IF;
  IF EXISTS (SELECT 1 FROM canon_reconciliation_logs WHERE candidate_id = c.id AND decision = 'PENDING') THEN
    RAISE EXCEPTION 'RECONCILIATION_REQUIRED' USING ERRCODE='P0001';
  END IF;
  IF p_hash = c.content_hash AND EXISTS (SELECT 1 FROM canon_reconciliation_logs WHERE candidate_id = c.id AND decision = 'KEEP_CANON_REVISE_PROSE') THEN
    RAISE EXCEPTION 'CANDIDATE_REQUIRES_REVISION' USING ERRCODE='P0001';
  END IF;
  v_had_accepted := EXISTS (SELECT 1 FROM book_section_acceptances WHERE book_id=c.book_id AND chapter_index=c.chapter_index AND subsection_index=c.subsection_index AND manuscript_status IN ('ACCEPTED','ESTABLISHED'));
  res := commit_fenced_section(c.book_id, p_user_id, c.chapter_index, c.subsection_index, p_worker, p_token, p_text, p_hash, c.master_plan_id, p_replace);
  UPDATE canon_reconciliation_logs SET application_status = 'AWAITING_SYNC' WHERE candidate_id = c.id AND application_status = 'PENDING_APPLICATION';
  IF v_had_accepted THEN v_flags := flag_downstream_memory(c.book_id, p_user_id, c.chapter_index, c.subsection_index, 'upstream_section_replaced'); END IF;
  UPDATE book_candidate_drafts SET validation_status='ACCEPTED', resolved_at=now() WHERE id = c.id;
  RETURN jsonb_build_object('status','accepted','commit',res,'memory_flags',v_flags);
END $function$;

-- Server-only: called by extraction after the accepted text is in story memory.
CREATE OR REPLACE FUNCTION public.finalize_canon_application(p_book_id uuid, p_user_id uuid, p_chapter integer, p_sub integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE n int;
BEGIN
  UPDATE canon_reconciliation_logs SET application_status='APPLIED', applied_at=now()
   WHERE book_id=p_book_id AND user_id=p_user_id AND chapter_index=p_chapter AND subsection_index=p_sub AND application_status='AWAITING_SYNC';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('applied', n);
END $function$;

-- Owner: discard a candidate. Its approved-but-unapplied canon changes are abandoned, so the
-- previous canon stays authoritative.
CREATE OR REPLACE FUNCTION public.discard_candidate_draft(p_candidate_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c book_candidate_drafts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO c FROM book_candidate_drafts WHERE id = p_candidate_id FOR UPDATE;
  IF NOT FOUND OR c.user_id <> auth.uid() THEN RAISE EXCEPTION 'not found'; END IF;
  IF c.validation_status NOT IN ('BLOCKED_MATERIAL','NEEDS_AUTHOR_REVIEW') THEN RETURN jsonb_build_object('status','not_open'); END IF;
  UPDATE book_candidate_drafts SET validation_status='DISCARDED', resolved_at=now() WHERE id = c.id;
  UPDATE canon_reconciliation_logs SET application_status='ABANDONED'
   WHERE candidate_id = c.id AND application_status IN ('PENDING_APPLICATION','NOT_APPLICABLE') AND decision <> 'PENDING';
  RETURN jsonb_build_object('status','discarded');
END $function$;

-- Owner: re-establish reviewed memory for one section after checking it against the new upstream text.
CREATE OR REPLACE FUNCTION public.confirm_section_memory(p_book_id uuid, p_chapter integer, p_sub integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE here int := story_position(p_chapter, p_sub); n int := 0; k int;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM books WHERE id=p_book_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'not found'; END IF;
  UPDATE canonical_facts SET canon_status='ESTABLISHED' WHERE book_id=p_book_id AND canon_status='UNCERTAIN' AND story_position(source_chapter_index, source_subsection_index)=here; GET DIAGNOSTICS k=ROW_COUNT; n:=n+k;
  UPDATE character_states SET canon_status='ESTABLISHED' WHERE book_id=p_book_id AND canon_status='UNCERTAIN' AND story_position(chapter_index, subsection_index)=here; GET DIAGNOSTICS k=ROW_COUNT; n:=n+k;
  UPDATE narrative_events SET canon_status='ESTABLISHED' WHERE book_id=p_book_id AND canon_status='UNCERTAIN' AND story_position(chapter_index, subsection_index)=here; GET DIAGNOSTICS k=ROW_COUNT; n:=n+k;
  UPDATE story_timeline SET canon_status='ESTABLISHED' WHERE book_id=p_book_id AND canon_status='UNCERTAIN' AND story_position(chapter_index, subsection_index)=here; GET DIAGNOSTICS k=ROW_COUNT; n:=n+k;
  UPDATE plot_threads SET canon_status='ESTABLISHED' WHERE book_id=p_book_id AND canon_status='UNCERTAIN' AND story_position(introduced_chapter_index, introduced_subsection_index)=here; GET DIAGNOSTICS k=ROW_COUNT; n:=n+k;
  UPDATE story_entities SET canon_status='ESTABLISHED' WHERE book_id=p_book_id AND canon_status='UNCERTAIN' AND story_position(first_chapter_index, first_subsection_index)=here; GET DIAGNOSTICS k=ROW_COUNT; n:=n+k;
  UPDATE identity_attribute_versions SET canon_status='ESTABLISHED' WHERE book_id=p_book_id AND canon_status='UNCERTAIN' AND effective_position=here; GET DIAGNOSTICS k=ROW_COUNT; n:=n+k;
  UPDATE narrative_exact_anchors SET canon_status='ESTABLISHED' WHERE book_id=p_book_id AND canon_status='UNCERTAIN' AND effective_chapter_index=p_chapter; GET DIAGNOSTICS k=ROW_COUNT; n:=n+k;
  RETURN jsonb_build_object('reestablished', n);
END $function$;

-- Owner read-only: what an upstream regeneration would affect.
CREATE OR REPLACE FUNCTION public.calculate_downstream_blast_radius(p_book_id uuid, p_chapter integer, p_sub integer)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE here int := story_position(p_chapter, p_sub); chars jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM books WHERE id=p_book_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'not found'; END IF;
  SELECT coalesce(jsonb_agg(DISTINCT sc.name), '[]'::jsonb) INTO chars FROM character_states cs JOIN story_characters sc ON sc.id = cs.character_id
   WHERE cs.book_id=p_book_id AND story_position(cs.chapter_index, cs.subsection_index)=here
     AND EXISTS (SELECT 1 FROM character_states d WHERE d.book_id=p_book_id AND d.character_id=cs.character_id AND story_position(d.chapter_index, d.subsection_index) > here);
  RETURN jsonb_build_object(
    'accepted_downstream_sections', (SELECT count(*) FROM book_section_acceptances WHERE book_id=p_book_id AND manuscript_status IN ('ACCEPTED','ESTABLISHED') AND story_position(chapter_index, subsection_index) > here),
    'facts', (SELECT count(*) FROM canonical_facts WHERE book_id=p_book_id AND canon_status='ESTABLISHED' AND story_position(source_chapter_index, source_subsection_index) >= here),
    'states', (SELECT count(*) FROM character_states WHERE book_id=p_book_id AND canon_status='ESTABLISHED' AND story_position(chapter_index, subsection_index) >= here),
    'events', (SELECT count(*) FROM narrative_events WHERE book_id=p_book_id AND canon_status='ESTABLISHED' AND story_position(chapter_index, subsection_index) >= here),
    'timeline', (SELECT count(*) FROM story_timeline WHERE book_id=p_book_id AND canon_status='ESTABLISHED' AND story_position(chapter_index, subsection_index) >= here),
    'threads', (SELECT count(*) FROM plot_threads WHERE book_id=p_book_id AND canon_status='ESTABLISHED' AND story_position(introduced_chapter_index, introduced_subsection_index) >= here),
    'anchors', (SELECT count(*) FROM narrative_exact_anchors WHERE book_id=p_book_id AND is_active AND canon_status='ESTABLISHED' AND effective_chapter_index > p_chapter),
    'characters_carried_forward', chars);
END $function$;

REVOKE ALL ON FUNCTION public.save_candidate_draft(uuid,uuid,integer,integer,uuid,text,text,text,jsonb,jsonb,text,uuid,text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.flag_downstream_memory(uuid,uuid,integer,integer,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_candidate_draft(uuid,uuid,text,bigint,text,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_canon_application(uuid,uuid,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_candidate_draft(uuid,uuid,integer,integer,uuid,text,text,text,jsonb,jsonb,text,uuid,text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.flag_downstream_memory(uuid,uuid,integer,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_candidate_draft(uuid,uuid,text,bigint,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_canon_application(uuid,uuid,integer,integer) TO service_role;
REVOKE ALL ON FUNCTION public.discard_candidate_draft(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_section_memory(uuid,integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calculate_downstream_blast_radius(uuid,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discard_candidate_draft(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_section_memory(uuid,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_downstream_blast_radius(uuid,integer,integer) TO authenticated;