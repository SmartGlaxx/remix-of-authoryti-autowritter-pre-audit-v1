ALTER TABLE public.book_master_plans ADD COLUMN IF NOT EXISTS plan_skeleton jsonb;
ALTER TABLE public.book_master_plans ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.book_progressive_plans ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS book_master_plans_idem_uq ON public.book_master_plans(book_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS book_progressive_plans_idem_uq ON public.book_progressive_plans(book_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.protect_master_plan_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status IN ('APPROVED','SUPERSEDED','CANCELLED') AND (
     NEW.premise IS DISTINCT FROM OLD.premise OR NEW.master_synopsis IS DISTINCT FROM OLD.master_synopsis OR
     NEW.intended_ending IS DISTINCT FROM OLD.intended_ending OR NEW.genre_adapter_type IS DISTINCT FROM OLD.genre_adapter_type OR
     NEW.genre_data IS DISTINCT FROM OLD.genre_data OR NEW.major_reveals IS DISTINCT FROM OLD.major_reveals OR
     NEW.twist_alternatives IS DISTINCT FROM OLD.twist_alternatives OR NEW.version IS DISTINCT FROM OLD.version OR
     NEW.plan_skeleton IS DISTINCT FROM OLD.plan_skeleton OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
     NEW.book_id IS DISTINCT FROM OLD.book_id) THEN
    RAISE EXCEPTION 'Approved master plans are immutable; create a new version.';
  END IF;
  IF OLD.status IN ('SUPERSEDED','CANCELLED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Master plan status % is terminal.', OLD.status;
  END IF;
  IF OLD.status = 'APPROVED' AND NEW.status NOT IN ('APPROVED','SUPERSEDED','CANCELLED') THEN
    RAISE EXCEPTION 'Invalid master plan transition % -> %', OLD.status, NEW.status;
  END IF;
  IF NEW.status = 'APPROVED' AND OLD.status <> 'APPROVED' THEN NEW.approved_at := now(); END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Save a new DRAFT master plan version (idempotent on key). Server-only.
CREATE OR REPLACE FUNCTION public.save_master_plan_draft(
  p_book_id uuid, p_user_id uuid, p_idem text, p_adapter text, p_premise text, p_synopsis text,
  p_ending text, p_genre_data jsonb, p_reveals jsonb, p_alternatives jsonb, p_skeleton jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.book_master_plans; v_prev uuid; v_ver int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.books WHERE id = p_book_id AND user_id = p_user_id) THEN
    RAISE EXCEPTION 'BOOK_NOT_OWNED';
  END IF;
  SELECT * INTO v_row FROM public.book_master_plans WHERE book_id = p_book_id AND idempotency_key = p_idem;
  IF FOUND THEN RETURN jsonb_build_object('id', v_row.id, 'version', v_row.version, 'reused', true); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('master_plan:' || p_book_id::text));
  SELECT id, version INTO v_prev, v_ver FROM public.book_master_plans WHERE book_id = p_book_id ORDER BY version DESC LIMIT 1;
  INSERT INTO public.book_master_plans(book_id, user_id, version, status, genre_adapter_type, premise, master_synopsis,
    intended_ending, genre_data, major_reveals, twist_alternatives, plan_skeleton, supersedes_id, idempotency_key)
  VALUES (p_book_id, p_user_id, COALESCE(v_ver, 0) + 1, 'DRAFT', p_adapter, p_premise, p_synopsis, p_ending,
    p_genre_data, p_reveals, p_alternatives, p_skeleton, v_prev, p_idem)
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('id', v_row.id, 'version', v_row.version, 'reused', false);
END $$;

-- Owner approves a DRAFT: prior APPROVED version is retired (SUPERSEDED, contents untouched) in the same transaction.
CREATE OR REPLACE FUNCTION public.approve_master_plan(p_plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.book_master_plans; v_old uuid;
BEGIN
  SELECT * INTO v_row FROM public.book_master_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND OR v_row.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'PLAN_NOT_OWNED'; END IF;
  IF v_row.status = 'APPROVED' THEN RETURN jsonb_build_object('id', v_row.id, 'already', true); END IF;
  IF v_row.status <> 'DRAFT' THEN RAISE EXCEPTION 'PLAN_NOT_DRAFT'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('master_plan:' || v_row.book_id::text));
  UPDATE public.book_master_plans SET status = 'SUPERSEDED'
    WHERE book_id = v_row.book_id AND status = 'APPROVED' RETURNING id INTO v_old;
  UPDATE public.book_master_plans SET status = 'APPROVED' WHERE id = p_plan_id;
  RETURN jsonb_build_object('id', p_plan_id, 'retired', v_old, 'already', false);
END $$;

-- Atomic batch save of progressive plans (one chapter checkpoint). Idempotent on key. Server-only.
CREATE OR REPLACE FUNCTION public.save_progressive_plan_batch(
  p_book_id uuid, p_user_id uuid, p_master_plan_id uuid, p_idem text, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it jsonb; v_ver int; v_ids uuid[] := '{}'; v_id uuid; v_sub int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.book_master_plans WHERE id = p_master_plan_id AND book_id = p_book_id AND user_id = p_user_id
                 AND status IN ('DRAFT','APPROVED')) THEN
    RAISE EXCEPTION 'MASTER_PLAN_NOT_USABLE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.book_progressive_plans WHERE book_id = p_book_id AND idempotency_key LIKE p_idem || ':%') THEN
    SELECT array_agg(id) INTO v_ids FROM public.book_progressive_plans WHERE book_id = p_book_id AND idempotency_key LIKE p_idem || ':%';
    RETURN jsonb_build_object('ids', to_jsonb(v_ids), 'reused', true);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('progressive:' || p_master_plan_id::text));
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sub := CASE WHEN it ? 'subsection_index' AND it->>'subsection_index' IS NOT NULL THEN (it->>'subsection_index')::int END;
    SELECT COALESCE(MAX(version), 0) INTO v_ver FROM public.book_progressive_plans
      WHERE book_id = p_book_id AND master_plan_id = p_master_plan_id AND plan_level = it->>'plan_level'
        AND chapter_index = (it->>'chapter_index')::int AND COALESCE(subsection_index, -1) = COALESCE(v_sub, -1);
    UPDATE public.book_progressive_plans SET plan_status = 'SUPERSEDED'
      WHERE book_id = p_book_id AND master_plan_id = p_master_plan_id AND plan_level = it->>'plan_level'
        AND chapter_index = (it->>'chapter_index')::int AND COALESCE(subsection_index, -1) = COALESCE(v_sub, -1)
        AND plan_status = 'PLANNED';
    INSERT INTO public.book_progressive_plans(book_id, user_id, master_plan_id, plan_level, chapter_index, subsection_index,
      plan_status, content, dependencies, version, idempotency_key)
    VALUES (p_book_id, p_user_id, p_master_plan_id, it->>'plan_level', (it->>'chapter_index')::int, v_sub,
      'PLANNED', COALESCE(it->'content', '{}'::jsonb), COALESCE(it->'dependencies', '[]'::jsonb), v_ver + 1,
      p_idem || ':' || (it->>'plan_level') || ':' || (it->>'chapter_index') || ':' || COALESCE(v_sub::text, '-'))
    RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
  END LOOP;
  RETURN jsonb_build_object('ids', to_jsonb(v_ids), 'reused', false);
END $$;

-- Owner marks planned nodes READY (author checkpoint); prior READY version of the same node is retired.
CREATE OR REPLACE FUNCTION public.approve_progressive_plans(p_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.book_progressive_plans; n int := 0;
BEGIN
  FOR r IN SELECT * FROM public.book_progressive_plans WHERE id = ANY(p_ids) ORDER BY chapter_index, subsection_index FOR UPDATE LOOP
    IF r.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'PLAN_NOT_OWNED'; END IF;
    IF r.plan_status = 'READY' THEN CONTINUE; END IF;
    IF r.plan_status <> 'PLANNED' THEN RAISE EXCEPTION 'PLAN_NOT_PLANNED'; END IF;
    UPDATE public.book_progressive_plans SET plan_status = 'SUPERSEDED'
      WHERE book_id = r.book_id AND master_plan_id = r.master_plan_id AND plan_level = r.plan_level
        AND chapter_index = r.chapter_index AND COALESCE(subsection_index, -1) = COALESCE(r.subsection_index, -1)
        AND plan_status = 'READY' AND id <> r.id;
    UPDATE public.book_progressive_plans SET plan_status = 'READY' WHERE id = r.id;
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('approved', n);
END $$;

REVOKE ALL ON FUNCTION public.save_master_plan_draft(uuid,uuid,text,text,text,text,text,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_progressive_plan_batch(uuid,uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_master_plan(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_progressive_plans(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_master_plan_draft(uuid,uuid,text,text,text,text,text,jsonb,jsonb,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_progressive_plan_batch(uuid,uuid,uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_master_plan(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_progressive_plans(uuid[]) TO authenticated;