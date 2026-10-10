-- Server-only: mirror the ACCEPTED text into the book outline, only when it matches the current
-- acceptance hash — a held or superseded draft can never reach the outline this way.
CREATE OR REPLACE FUNCTION public.write_accepted_outline_text(p_book_id uuid, p_user_id uuid, p_chapter integer, p_sub integer, p_text text, p_hash text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE b books%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM book_section_acceptances WHERE book_id=p_book_id AND user_id=p_user_id AND chapter_index=p_chapter AND subsection_index=p_sub
                 AND content_hash=p_hash AND manuscript_status IN ('ACCEPTED','ESTABLISHED')) THEN
    RETURN jsonb_build_object('status','not_accepted');
  END IF;
  SELECT * INTO b FROM books WHERE id=p_book_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR b.outline #> ARRAY['chapters', p_chapter::text, 'subsections', p_sub::text] IS NULL THEN RETURN jsonb_build_object('status','no_section'); END IF;
  UPDATE books SET outline = jsonb_set(jsonb_set(b.outline, ARRAY['chapters', p_chapter::text, 'subsections', p_sub::text, 'content'], to_jsonb(p_text)),
                                      ARRAY['chapters', p_chapter::text, 'subsections', p_sub::text, 'status'], '"completed"'::jsonb)
   WHERE id=p_book_id;
  RETURN jsonb_build_object('status','written');
END $function$;
REVOKE ALL ON FUNCTION public.write_accepted_outline_text(uuid,uuid,integer,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_accepted_outline_text(uuid,uuid,integer,integer,text,text) TO service_role;