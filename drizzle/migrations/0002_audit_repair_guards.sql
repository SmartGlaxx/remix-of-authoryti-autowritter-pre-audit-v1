CREATE OR REPLACE FUNCTION public.protect_audit_repair_history() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.book_id<>OLD.book_id OR NEW.user_id<>OLD.user_id OR NEW.audit_id<>OLD.audit_id OR NEW.original_outline IS DISTINCT FROM OLD.original_outline THEN RAISE EXCEPTION 'IMMUTABLE_REPAIR_HISTORY'; END IF;
 IF jsonb_array_length(NEW.patches)<jsonb_array_length(OLD.patches) OR EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.patches) WITH ORDINALITY e(value,ordinality) WHERE NEW.patches->((e.ordinality-1)::integer) IS DISTINCT FROM e.value) THEN RAISE EXCEPTION 'IMMUTABLE_REPAIR_PATCHES'; END IF;
 IF OLD.rollback_complete AND NEW.extraction_backup IS DISTINCT FROM OLD.extraction_backup THEN RAISE EXCEPTION 'IMMUTABLE_MEMORY_BACKUP'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_audit_repair_history BEFORE UPDATE ON public.manuscript_repair_runs FOR EACH ROW EXECUTE FUNCTION public.protect_audit_repair_history();
CREATE OR REPLACE FUNCTION public.preserve_author_canon_during_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='canonical_facts' OR TG_TABLE_NAME='identity_attribute_versions' THEN
  IF OLD.authority IN ('USER_CANON','OUTLINE_CANON') AND EXISTS(SELECT 1 FROM manuscript_repair_runs WHERE book_id=OLD.book_id AND status IN ('RUNNING','SYNCING','NEEDS_SYNC')) THEN NEW.canon_status:=OLD.canon_status; NEW.canon_flag:=OLD.canon_flag; END IF;
 ELSIF TG_TABLE_NAME='narrative_exact_anchors' THEN
  IF OLD.source_type='author' AND EXISTS(SELECT 1 FROM manuscript_repair_runs WHERE book_id=OLD.book_id AND status IN ('RUNNING','SYNCING','NEEDS_SYNC')) THEN NEW.canon_status:=OLD.canon_status; NEW.canon_flag:=OLD.canon_flag; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_author_canon_during_audit BEFORE UPDATE ON public.canonical_facts FOR EACH ROW EXECUTE FUNCTION public.preserve_author_canon_during_audit();
CREATE TRIGGER preserve_author_identity_during_audit BEFORE UPDATE ON public.identity_attribute_versions FOR EACH ROW EXECUTE FUNCTION public.preserve_author_canon_during_audit();
CREATE TRIGGER preserve_author_anchor_during_audit BEFORE UPDATE ON public.narrative_exact_anchors FOR EACH ROW EXECUTE FUNCTION public.preserve_author_canon_during_audit();
CREATE OR REPLACE FUNCTION public.audit_repair_selftest() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=auth.uid(); bid uuid; aid uuid; rid uuid; lease jsonb; o jsonb; oldtext text:='Mara waited by the door.'; newtext text:='Mara waited by her brother.'; passed boolean:=false; rejected boolean:=false; val text;
BEGIN
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=uid) THEN RAISE EXCEPTION 'SIGN_IN_REQUIRED'; END IF;
 BEGIN
  o:=jsonb_build_object('chapters',jsonb_build_array(jsonb_build_object('title','Test','subsections',jsonb_build_array(jsonb_build_object('status','completed','content',oldtext)))));
  INSERT INTO books(user_id,title,book_type,theme,audience,pov,tone_profile,controls,outline) VALUES(uid,'[audit-selftest]','novel','test','adults','third','{}','{"planning_pipeline":"progressive"}',o) RETURNING id INTO bid;
  INSERT INTO manuscript_audits(book_id,user_id,cache_key,manuscript_hash,outline_hash,narrative_state_version,status) VALUES(bid,uid,'selftest','selftest','selftest','selftest','COMPLETE') RETURNING id INTO aid;
  INSERT INTO manuscript_repair_runs(book_id,user_id,audit_id,original_outline) VALUES(bid,uid,aid,o) RETURNING id INTO rid;
  BEGIN UPDATE books SET full_text='forbidden' WHERE id=bid; EXCEPTION WHEN OTHERS THEN IF SQLERRM='AUDIT_REPAIR_IN_PROGRESS' THEN rejected:=true; ELSE RAISE; END IF; END;
  IF NOT rejected THEN RAISE EXCEPTION 'LOCK_TEST_FAILED'; END IF;
  lease:=acquire_generation_lease(bid,uid,0,0,'selftest',120);
  rejected:=false;
  BEGIN PERFORM commit_audit_repair(rid,uid,'selftest',jsonb_build_array(jsonb_build_object('chapterIndex',0,'subsectionIndex',0,'original',oldtext,'text',newtext,'hash','test','token',(lease->>'fencing_token')::bigint+1)),'{}'); EXCEPTION WHEN OTHERS THEN IF SQLERRM='STALE_GENERATION_LEASE_REJECTED' THEN rejected:=true; ELSE RAISE; END IF; END;
  IF NOT rejected THEN RAISE EXCEPTION 'FENCE_TEST_FAILED'; END IF;
  PERFORM commit_audit_repair(rid,uid,'selftest',jsonb_build_array(jsonb_build_object('chapterIndex',0,'subsectionIndex',0,'original',oldtext,'text',newtext,'hash','test','token',(lease->>'fencing_token')::bigint)),'{"validation":{"passed":true}}');
  SELECT outline #>> '{chapters,0,subsections,0,content}' INTO val FROM books WHERE id=bid;
  IF val<>newtext OR NOT EXISTS(SELECT 1 FROM manuscript_repair_runs WHERE id=rid AND jsonb_array_length(patches)=1) THEN RAISE EXCEPTION 'COMMIT_TEST_FAILED'; END IF;
  rejected:=false;
  BEGIN UPDATE manuscript_repair_runs SET patches='[]' WHERE id=rid; EXCEPTION WHEN OTHERS THEN IF SQLERRM='IMMUTABLE_REPAIR_PATCHES' THEN rejected:=true; ELSE RAISE; END IF; END;
  IF NOT rejected THEN RAISE EXCEPTION 'HISTORY_TEST_FAILED'; END IF;
  UPDATE manuscript_repair_runs SET status='SYNCING' WHERE id=rid;
  PERFORM prepare_audit_memory_replay(rid,uid);
  IF NOT EXISTS(SELECT 1 FROM manuscript_repair_runs WHERE id=rid AND rollback_complete) THEN RAISE EXCEPTION 'REPLAY_TEST_FAILED'; END IF;
  passed:=true;
  RAISE EXCEPTION 'SELFTEST_ROLLBACK';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'SELFTEST_ROLLBACK' THEN RAISE; END IF;
 END;
 RETURN jsonb_build_object('passed',passed,'checks',jsonb_build_array('book_lock','stale_fence','atomic_commit','immutable_history','memory_replay'),'saved_test_data',false,'ai_cost',0);
END $$;
REVOKE ALL ON FUNCTION public.audit_repair_selftest() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.audit_repair_selftest() TO authenticated;