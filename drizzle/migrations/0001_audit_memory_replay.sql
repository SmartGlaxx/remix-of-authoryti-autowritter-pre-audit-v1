CREATE OR REPLACE FUNCTION public.prepare_audit_memory_replay(p_run_id uuid,p_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r manuscript_repair_runs%ROWTYPE; x narrative_extractions%ROWTYPE; u jsonb; backup jsonb:='[]';
BEGIN
 SELECT * INTO r FROM manuscript_repair_runs WHERE id=p_run_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND OR r.status NOT IN ('SYNCING','NEEDS_SYNC') THEN RAISE EXCEPTION 'REPAIR_NOT_SYNCING'; END IF;
 IF r.rollback_complete THEN RETURN jsonb_build_object('status','ready'); END IF;
 FOR x IN SELECT * FROM narrative_extractions WHERE book_id=r.book_id AND story_position(chapter_index,subsection_index)>=r.earliest_position ORDER BY chapter_index DESC,subsection_index DESC LOOP
  backup:=backup||jsonb_build_array(jsonb_build_object('extraction',to_jsonb(x),'facts',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM canonical_facts t WHERE extraction_id=x.id),'states',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM character_states t WHERE extraction_id=x.id),'events',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM narrative_events t WHERE extraction_id=x.id),'timeline',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM story_timeline t WHERE extraction_id=x.id),'threads',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM plot_threads t WHERE extraction_id=x.id),'knowledge',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM knowledge_acquisitions t WHERE extraction_id=x.id)));
  FOR u IN SELECT value FROM jsonb_array_elements(coalesce(x.applied->'undo','[]')) WITH ORDINALITY ORDER BY ordinality DESC LOOP
   IF u->>'table'='plot_threads' THEN
    UPDATE plot_threads SET status=coalesce(u->'before'->>'status',status),resolution_notes=u->'before'->>'resolution_notes',resolved_chapter_index=(u->'before'->>'resolved_chapter_index')::integer,resolution_event_id=(u->'before'->>'resolution_event_id')::uuid,superseded_by=(u->'before'->>'superseded_by')::uuid WHERE id=(u->>'id')::uuid AND book_id=r.book_id;
   ELSIF u->>'table'='canonical_facts' THEN
    UPDATE canonical_facts SET conflict_status=coalesce(u->'before'->>'conflict_status',conflict_status),conflicting_fact_id=(u->'before'->>'conflicting_fact_id')::uuid WHERE id=(u->>'id')::uuid AND book_id=r.book_id;
   END IF;
  END LOOP;
  DELETE FROM knowledge_acquisitions WHERE extraction_id=x.id AND book_id=r.book_id;
  DELETE FROM story_timeline WHERE extraction_id=x.id AND book_id=r.book_id;
  DELETE FROM canonical_facts WHERE extraction_id=x.id AND book_id=r.book_id AND authority NOT IN ('USER_CANON','OUTLINE_CANON');
  DELETE FROM character_states WHERE extraction_id=x.id AND book_id=r.book_id;
  DELETE FROM narrative_events WHERE extraction_id=x.id AND book_id=r.book_id;
  DELETE FROM plot_threads WHERE extraction_id=x.id AND book_id=r.book_id AND authority NOT IN ('USER_CANON','OUTLINE_CANON');
  UPDATE narrative_extractions SET status='failed',applied='{}',error='audit_replay_required' WHERE id=x.id;
 END LOOP;
 backup:=backup||jsonb_build_array(jsonb_build_object('entities',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM story_entities t WHERE book_id=r.book_id AND story_position(first_chapter_index,first_subsection_index)>=r.earliest_position),'identity_versions',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM identity_attribute_versions t WHERE book_id=r.book_id AND effective_position>=r.earliest_position AND authority NOT IN ('USER_CANON','OUTLINE_CANON'))));
 DELETE FROM story_entities WHERE book_id=r.book_id AND story_position(first_chapter_index,first_subsection_index)>=r.earliest_position;
 DELETE FROM identity_attribute_versions WHERE book_id=r.book_id AND effective_position>=r.earliest_position AND authority NOT IN ('USER_CANON','OUTLINE_CANON');
 UPDATE book_section_acceptances SET extraction_status='PENDING_EXTRACTION' WHERE book_id=r.book_id AND story_position(chapter_index,subsection_index)>=r.earliest_position AND manuscript_status IN ('ACCEPTED','ESTABLISHED');
 UPDATE manuscript_repair_runs SET extraction_backup=backup,rollback_complete=true,status='SYNCING',updated_at=now() WHERE id=r.id;
 RETURN jsonb_build_object('status','ready');
END $$;
REVOKE ALL ON FUNCTION public.prepare_audit_memory_replay(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_audit_memory_replay(uuid,uuid) TO service_role;