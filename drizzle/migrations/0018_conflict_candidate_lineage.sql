CREATE OR REPLACE FUNCTION public.commit_candidate_draft(p_candidate_id uuid, p_user_id uuid, p_worker text, p_token bigint, p_text text, p_hash text, p_replace boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE c book_candidate_drafts%ROWTYPE; res jsonb; v_flags jsonb := null; v_had_accepted boolean; v_lineage uuid[];
BEGIN
  SELECT * INTO c FROM book_candidate_drafts WHERE id = p_candidate_id FOR UPDATE;
  IF NOT FOUND OR c.user_id <> p_user_id THEN RAISE EXCEPTION 'CANDIDATE_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF c.validation_status NOT IN ('BLOCKED_MATERIAL','NEEDS_AUTHOR_REVIEW') THEN RAISE EXCEPTION 'CANDIDATE_NOT_OPEN' USING ERRCODE='P0001'; END IF;
  WITH RECURSIVE ancestry AS (
    SELECT id, parent_candidate_id, ARRAY[id] AS visited FROM book_candidate_drafts WHERE id=c.id
    UNION ALL
    SELECT p.id, p.parent_candidate_id, a.visited || p.id FROM book_candidate_drafts p JOIN ancestry a ON p.id=a.parent_candidate_id
    WHERE p.book_id=c.book_id AND p.user_id=p_user_id AND NOT p.id=ANY(a.visited)
  ) SELECT array_agg(id) INTO v_lineage FROM ancestry;
  IF EXISTS (SELECT 1 FROM canon_reconciliation_logs WHERE book_id=c.book_id AND candidate_id=ANY(v_lineage) AND decision='PENDING' AND application_status<>'ABANDONED') THEN
    RAISE EXCEPTION 'RECONCILIATION_REQUIRED' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM canon_reconciliation_logs l JOIN book_candidate_drafts original ON original.id=l.candidate_id
    WHERE l.book_id=c.book_id AND l.candidate_id=ANY(v_lineage) AND l.decision='KEEP_CANON_REVISE_PROSE' AND l.application_status<>'ABANDONED' AND original.content_hash=p_hash) THEN
    RAISE EXCEPTION 'CANDIDATE_REQUIRES_REVISION' USING ERRCODE='P0001';
  END IF;
  v_had_accepted := EXISTS (SELECT 1 FROM book_section_acceptances WHERE book_id=c.book_id AND chapter_index=c.chapter_index AND subsection_index=c.subsection_index AND manuscript_status IN ('ACCEPTED','ESTABLISHED'));
  res := commit_fenced_section(c.book_id,p_user_id,c.chapter_index,c.subsection_index,p_worker,p_token,p_text,p_hash,c.master_plan_id,p_replace);
  UPDATE canon_reconciliation_logs SET application_status='AWAITING_SYNC' WHERE book_id=c.book_id AND candidate_id=ANY(v_lineage) AND application_status='PENDING_APPLICATION';
  IF v_had_accepted THEN v_flags := flag_downstream_memory(c.book_id,p_user_id,c.chapter_index,c.subsection_index,'upstream_section_replaced'); END IF;
  UPDATE book_candidate_drafts SET validation_status='ACCEPTED',resolved_at=now() WHERE id=c.id;
  RETURN jsonb_build_object('status','accepted','commit',res,'memory_flags',v_flags);
END $function$;
REVOKE ALL ON FUNCTION public.commit_candidate_draft(uuid,uuid,text,bigint,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_candidate_draft(uuid,uuid,text,bigint,text,text,boolean) TO service_role;