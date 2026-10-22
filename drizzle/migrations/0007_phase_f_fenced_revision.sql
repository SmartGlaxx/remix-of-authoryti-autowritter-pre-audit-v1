CREATE OR REPLACE FUNCTION public.commit_fenced_revision(p_book_id uuid, p_user_id uuid, p_chapter integer, p_sub integer, p_worker text, p_token bigint, p_original text, p_text text, p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b books%ROWTYPE; o jsonb; cur text; ft text; idx integer;
BEGIN
  PERFORM assert_generation_fence(p_book_id, p_chapter, p_sub, p_worker, p_token);
  SELECT * INTO b FROM books WHERE id = p_book_id FOR UPDATE;
  IF NOT FOUND OR b.user_id <> p_user_id THEN RAISE EXCEPTION 'BOOK_NOT_OWNED' USING ERRCODE = 'P0001'; END IF;
  IF char_length(coalesce(p_text,'')) = 0 THEN RAISE EXCEPTION 'EMPTY_SECTION' USING ERRCODE = 'P0001'; END IF;
  cur := b.outline #>> ARRAY['chapters', p_chapter::text, 'subsections', p_sub::text, 'content'];
  IF cur IS DISTINCT FROM p_original THEN
    UPDATE book_generation_leases SET status='RELEASED' WHERE book_id=p_book_id AND chapter_index=p_chapter AND subsection_index=p_sub AND worker_id=p_worker AND fencing_token=p_token;
    RETURN jsonb_build_object('status','text_changed');
  END IF;
  o := jsonb_set(b.outline, ARRAY['chapters', p_chapter::text, 'subsections', p_sub::text, 'content'], to_jsonb(p_text));
  ft := coalesce(b.full_text,'');
  idx := strpos(ft, p_original);
  IF idx > 0 THEN ft := left(ft, idx - 1) || p_text || substr(ft, idx + char_length(p_original)); END IF;
  UPDATE books SET outline = o, full_text = ft, total_char_count = char_length(ft) WHERE id = p_book_id;
  UPDATE book_section_acceptances SET content_hash = p_hash, extraction_status = 'PENDING_EXTRACTION', error = NULL
   WHERE book_id=p_book_id AND chapter_index=p_chapter AND subsection_index=p_sub AND manuscript_status IN ('ACCEPTED','ESTABLISHED');
  UPDATE book_generation_leases SET status='RELEASED' WHERE book_id=p_book_id AND chapter_index=p_chapter AND subsection_index=p_sub AND worker_id=p_worker AND fencing_token=p_token;
  RETURN jsonb_build_object('status','committed');
END $$;
REVOKE ALL ON FUNCTION public.commit_fenced_revision(uuid,uuid,integer,integer,text,bigint,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_fenced_revision(uuid,uuid,integer,integer,text,bigint,text,text,text) TO service_role;