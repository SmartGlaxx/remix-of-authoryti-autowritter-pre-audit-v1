-- Replacing an accepted section flags memory derived from it (and later) in the SAME transaction
-- as the manuscript write, so stale memory can never stay authoritative after an upstream rewrite.
CREATE OR REPLACE FUNCTION public.commit_fenced_section(p_book_id uuid, p_user_id uuid, p_chapter integer, p_sub integer, p_worker text, p_token bigint, p_text text, p_hash text, p_master_plan_id uuid, p_replace boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE b books%ROWTYPE; existing book_section_acceptances%ROWTYPE; nt text; v_flags jsonb := null;
BEGIN
  PERFORM assert_generation_fence(p_book_id, p_chapter, p_sub, p_worker, p_token);
  SELECT * INTO b FROM books WHERE id = p_book_id FOR UPDATE;
  IF NOT FOUND OR b.user_id <> p_user_id THEN RAISE EXCEPTION 'BOOK_NOT_OWNED' USING ERRCODE = 'P0001'; END IF;
  IF char_length(coalesce(p_text,'')) = 0 THEN RAISE EXCEPTION 'EMPTY_SECTION' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO existing FROM book_section_acceptances
   WHERE book_id = p_book_id AND chapter_index = p_chapter AND subsection_index = p_sub AND content_hash = p_hash;
  IF FOUND THEN
    UPDATE book_generation_leases SET status = 'RELEASED' WHERE book_id = p_book_id AND chapter_index = p_chapter AND subsection_index = p_sub AND worker_id = p_worker AND fencing_token = p_token;
    RETURN jsonb_build_object('status','duplicate','acceptance_id',existing.id);
  END IF;
  IF EXISTS (SELECT 1 FROM book_section_acceptances WHERE book_id = p_book_id AND chapter_index = p_chapter AND subsection_index = p_sub
             AND manuscript_status IN ('ACCEPTED','ESTABLISHED')) THEN
    IF NOT p_replace THEN RAISE EXCEPTION 'ACCEPTED_SECTION_PROTECTED' USING ERRCODE = 'P0001'; END IF;
    UPDATE book_section_acceptances SET manuscript_status = 'REVISED'
     WHERE book_id = p_book_id AND chapter_index = p_chapter AND subsection_index = p_sub AND manuscript_status IN ('ACCEPTED','ESTABLISHED');
    v_flags := flag_downstream_memory(p_book_id, p_user_id, p_chapter, p_sub, 'upstream_section_replaced');
  END IF;
  nt := right(coalesce(b.full_text,'') || CASE WHEN coalesce(b.full_text,'') = '' THEN '' ELSE E'\n\n' END || p_text, 500000);
  UPDATE books SET full_text = nt, total_char_count = char_length(nt) WHERE id = p_book_id;
  INSERT INTO book_section_acceptances (book_id, user_id, chapter_index, subsection_index, master_plan_id, content_hash, manuscript_status, extraction_status, attempts)
  VALUES (p_book_id, p_user_id, p_chapter, p_sub, p_master_plan_id, p_hash, 'ACCEPTED', 'PENDING_EXTRACTION', 1)
  RETURNING * INTO existing;
  UPDATE book_generation_leases SET status = 'RELEASED' WHERE book_id = p_book_id AND chapter_index = p_chapter AND subsection_index = p_sub AND worker_id = p_worker AND fencing_token = p_token;
  RETURN jsonb_build_object('status','committed','acceptance_id',existing.id,'memory_flags',v_flags);
END $function$;