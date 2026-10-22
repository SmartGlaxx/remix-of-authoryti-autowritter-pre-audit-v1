-- Discarding a held draft abandons every contradiction raised only by that draft (decided or not),
-- so they never block later sections; evidence rows are kept for the audit trail.
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
   WHERE candidate_id = c.id AND application_status IN ('PENDING_APPLICATION','NOT_APPLICABLE');
  RETURN jsonb_build_object('status','discarded');
END $function$;