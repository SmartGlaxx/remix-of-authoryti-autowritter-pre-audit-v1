CREATE TABLE public.manuscript_repair_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, audit_id uuid NOT NULL REFERENCES public.manuscript_audits(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'RUNNING' CHECK(status IN ('RUNNING','SYNCING','NEEDS_SYNC','COMPLETE','FAILED')), original_outline jsonb NOT NULL, patches jsonb NOT NULL DEFAULT '[]', outcomes jsonb NOT NULL DEFAULT '[]', extraction_backup jsonb NOT NULL DEFAULT '[]', sync_cursor integer NOT NULL DEFAULT 0, rollback_complete boolean NOT NULL DEFAULT false, earliest_position integer, error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.manuscript_repair_runs TO authenticated;
GRANT ALL ON public.manuscript_repair_runs TO service_role;
ALTER TABLE public.manuscript_repair_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_read ON public.manuscript_repair_runs FOR SELECT TO authenticated USING (auth.uid()=user_id);
CREATE UNIQUE INDEX one_active_manuscript_repair ON public.manuscript_repair_runs(book_id) WHERE status IN ('RUNNING','SYNCING','NEEDS_SYNC');
CREATE OR REPLACE FUNCTION public.protect_book_during_audit_repair() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.outline IS DISTINCT FROM OLD.outline OR NEW.full_text IS DISTINCT FROM OLD.full_text OR NEW.story_setup IS DISTINCT FROM OLD.story_setup OR NEW.controls IS DISTINCT FROM OLD.controls THEN
  IF EXISTS (SELECT 1 FROM public.manuscript_repair_runs WHERE book_id=OLD.id AND status IN ('RUNNING','SYNCING','NEEDS_SYNC') AND id::text IS DISTINCT FROM current_setting('app.audit_repair_run',true)) THEN RAISE EXCEPTION 'AUDIT_REPAIR_IN_PROGRESS'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_book_during_audit_repair BEFORE UPDATE ON public.books FOR EACH ROW EXECUTE FUNCTION public.protect_book_during_audit_repair();
CREATE OR REPLACE FUNCTION public.commit_audit_repair(p_run_id uuid,p_user_id uuid,p_worker text,p_changes jsonb,p_details jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r manuscript_repair_runs%ROWTYPE; b books%ROWTYPE; e jsonb; o jsonb; ft text; earliest integer; ch integer; su integer;
BEGIN
 SELECT * INTO r FROM manuscript_repair_runs WHERE id=p_run_id FOR UPDATE;
 IF NOT FOUND OR r.user_id<>p_user_id OR r.status<>'RUNNING' THEN RAISE EXCEPTION 'REPAIR_RUN_NOT_ACTIVE'; END IF;
 SELECT * INTO b FROM books WHERE id=r.book_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BOOK_NOT_OWNED'; END IF;
 IF jsonb_typeof(p_changes)<>'array' OR jsonb_array_length(p_changes)<1 OR jsonb_array_length(p_changes)>24 THEN RAISE EXCEPTION 'INVALID_PATCH'; END IF;
 o:=b.outline;
 FOR e IN SELECT * FROM jsonb_array_elements(p_changes) LOOP
  ch:=(e->>'chapterIndex')::integer; su:=(e->>'subsectionIndex')::integer;
  PERFORM assert_generation_fence(b.id,ch,su,p_worker,(e->>'token')::bigint);
  IF o #>> ARRAY['chapters',ch::text,'subsections',su::text,'content'] IS DISTINCT FROM e->>'original' THEN RAISE EXCEPTION 'STALE_REPAIR_TEXT'; END IF;
  IF o #>> ARRAY['chapters',ch::text,'subsections',su::text,'status'] <> 'completed' OR char_length(coalesce(e->>'text',''))=0 THEN RAISE EXCEPTION 'INVALID_REPAIR_SECTION'; END IF;
  o:=jsonb_set(o,ARRAY['chapters',ch::text,'subsections',su::text,'content'],to_jsonb(e->>'text'));
  earliest:=least(coalesce(earliest,story_position(ch,su)),story_position(ch,su));
  UPDATE book_section_acceptances SET manuscript_status='REVISED' WHERE book_id=b.id AND chapter_index=ch AND subsection_index=su AND manuscript_status IN ('ACCEPTED','ESTABLISHED');
  INSERT INTO book_section_acceptances(book_id,user_id,chapter_index,subsection_index,master_plan_id,content_hash,manuscript_status,extraction_status,attempts) VALUES(b.id,p_user_id,ch,su,(SELECT id FROM book_master_plans WHERE book_id=b.id AND status='APPROVED' ORDER BY version DESC LIMIT 1),e->>'hash','ACCEPTED','PENDING_EXTRACTION',1);
  PERFORM flag_downstream_memory(b.id,p_user_id,ch,su,'full_audit_repair');
  UPDATE book_generation_leases SET status='RELEASED' WHERE book_id=b.id AND chapter_index=ch AND subsection_index=su AND worker_id=p_worker AND fencing_token=(e->>'token')::bigint;
 END LOOP;
 SELECT string_agg(s.value->>'content',E'\n\n' ORDER BY c.ordinality,s.ordinality) INTO ft FROM jsonb_array_elements(o->'chapters') WITH ORDINALITY c(value,ordinality),LATERAL jsonb_array_elements(c.value->'subsections') WITH ORDINALITY s(value,ordinality) WHERE coalesce(s.value->>'content','')<>'';
 PERFORM set_config('app.audit_repair_run',r.id::text,true);
 UPDATE books SET outline=o,full_text=coalesce(ft,''),total_char_count=char_length(coalesce(ft,'')) WHERE id=b.id;
 UPDATE manuscript_repair_runs SET patches=patches||jsonb_build_array(jsonb_build_object('changes',p_changes,'details',p_details,'at',now())),earliest_position=least(coalesce(earliest_position,earliest),earliest),updated_at=now() WHERE id=r.id;
 RETURN jsonb_build_object('status','committed');
END $$;
REVOKE ALL ON FUNCTION public.commit_audit_repair(uuid,uuid,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_audit_repair(uuid,uuid,text,jsonb,jsonb) TO service_role;
