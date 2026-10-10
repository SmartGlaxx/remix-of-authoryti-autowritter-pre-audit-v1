-- Phase B completion: generation leases (fencing), exact-detail anchors, canon reconciliation logs.

-- 1. Generation leases: one row per book section; fencing_token only ever increases.
CREATE TABLE public.book_generation_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  chapter_index integer NOT NULL CHECK (chapter_index >= 0),
  subsection_index integer NOT NULL CHECK (subsection_index >= 0),
  worker_id text NOT NULL CHECK (char_length(worker_id) BETWEEN 1 AND 200),
  fencing_token bigint NOT NULL DEFAULT 1 CHECK (fencing_token >= 1),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RELEASED')),
  leased_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, chapter_index, subsection_index)
);
GRANT SELECT ON public.book_generation_leases TO authenticated;
GRANT ALL ON public.book_generation_leases TO service_role;
ALTER TABLE public.book_generation_leases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read generation leases" ON public.book_generation_leases FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.protect_lease_fencing()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.fencing_token < OLD.fencing_token THEN RAISE EXCEPTION 'fencing token may not decrease'; END IF;
  IF NEW.book_id IS DISTINCT FROM OLD.book_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.chapter_index IS DISTINCT FROM OLD.chapter_index OR NEW.subsection_index IS DISTINCT FROM OLD.subsection_index THEN
    RAISE EXCEPTION 'lease identity is immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_protect_lease_fencing BEFORE UPDATE ON public.book_generation_leases
  FOR EACH ROW EXECUTE FUNCTION public.protect_lease_fencing();

-- Acquire: succeeds when no lease row exists, the lease was released, or it expired.
-- A takeover always bumps the token so the previous holder becomes stale.
CREATE OR REPLACE FUNCTION public.acquire_generation_lease(p_book_id uuid, p_user_id uuid, p_chapter integer, p_sub integer, p_worker text, p_ttl_seconds integer DEFAULT 120)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l book_generation_leases%ROWTYPE; v_ttl interval;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 5 OR p_ttl_seconds > 1800 THEN RAISE EXCEPTION 'ttl out of range'; END IF;
  IF NOT EXISTS (SELECT 1 FROM books WHERE id = p_book_id AND user_id = p_user_id) THEN RAISE EXCEPTION 'book not owned by user'; END IF;
  v_ttl := make_interval(secs => p_ttl_seconds);
  INSERT INTO book_generation_leases(book_id,user_id,chapter_index,subsection_index,worker_id,expires_at)
    VALUES (p_book_id,p_user_id,p_chapter,p_sub,p_worker,now()+v_ttl)
    ON CONFLICT (book_id,chapter_index,subsection_index) DO NOTHING
    RETURNING * INTO l;
  IF FOUND THEN RETURN jsonb_build_object('acquired',true,'lease_id',l.id,'fencing_token',l.fencing_token,'expires_at',l.expires_at); END IF;
  SELECT * INTO l FROM book_generation_leases WHERE book_id=p_book_id AND chapter_index=p_chapter AND subsection_index=p_sub FOR UPDATE;
  IF l.status = 'ACTIVE' AND l.expires_at > now() THEN
    IF l.worker_id = p_worker THEN -- idempotent re-acquire by same holder
      RETURN jsonb_build_object('acquired',true,'lease_id',l.id,'fencing_token',l.fencing_token,'expires_at',l.expires_at,'reentrant',true);
    END IF;
    RETURN jsonb_build_object('acquired',false,'reason','held','holder_expires_at',l.expires_at);
  END IF;
  UPDATE book_generation_leases SET worker_id=p_worker, fencing_token=l.fencing_token+1, status='ACTIVE',
    leased_at=now(), heartbeat_at=now(), expires_at=now()+v_ttl WHERE id=l.id RETURNING * INTO l;
  RETURN jsonb_build_object('acquired',true,'lease_id',l.id,'fencing_token',l.fencing_token,'expires_at',l.expires_at,'took_over',true);
END $$;

CREATE OR REPLACE FUNCTION public.renew_generation_lease(p_lease_id uuid, p_worker text, p_token bigint, p_ttl_seconds integer DEFAULT 120)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l book_generation_leases%ROWTYPE;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 5 OR p_ttl_seconds > 1800 THEN RAISE EXCEPTION 'ttl out of range'; END IF;
  UPDATE book_generation_leases SET heartbeat_at=now(), expires_at=now()+make_interval(secs => p_ttl_seconds)
    WHERE id=p_lease_id AND worker_id=p_worker AND fencing_token=p_token AND status='ACTIVE' AND expires_at > now()
    RETURNING * INTO l;
  IF NOT FOUND THEN RETURN jsonb_build_object('renewed',false,'reason','stale_or_expired'); END IF;
  RETURN jsonb_build_object('renewed',true,'expires_at',l.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.release_generation_lease(p_lease_id uuid, p_worker text, p_token bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE book_generation_leases SET status='RELEASED'
    WHERE id=p_lease_id AND worker_id=p_worker AND fencing_token=p_token AND status='ACTIVE';
  RETURN FOUND;
END $$;

-- Commit guard: call inside the same transaction as any manuscript write. Raises if stale.
CREATE OR REPLACE FUNCTION public.assert_generation_fence(p_book_id uuid, p_chapter integer, p_sub integer, p_worker text, p_token bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l book_generation_leases%ROWTYPE;
BEGIN
  SELECT * INTO l FROM book_generation_leases WHERE book_id=p_book_id AND chapter_index=p_chapter AND subsection_index=p_sub FOR SHARE;
  IF NOT FOUND OR l.status <> 'ACTIVE' OR l.expires_at <= now() OR l.worker_id <> p_worker OR l.fencing_token <> p_token THEN
    RAISE EXCEPTION 'STALE_GENERATION_LEASE_REJECTED' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- 2. Exact-detail anchors: verbatim details; text is immutable, changes create a new version.
CREATE TABLE public.narrative_exact_anchors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  anchor_key text NOT NULL CHECK (char_length(anchor_key) BETWEEN 1 AND 200),
  anchor_type text NOT NULL CHECK (anchor_type IN ('PROPER_NAME','NUMBER','CODE','QUOTE','DATE','TERM')),
  exact_text text NOT NULL CHECK (char_length(exact_text) BETWEEN 1 AND 2000),
  match_mode text NOT NULL DEFAULT 'EXACT' CHECK (match_mode IN ('EXACT','CASE_INSENSITIVE','NONE')),
  context_hint text NOT NULL DEFAULT '',
  source_type text NOT NULL CHECK (source_type IN ('MASTER_PLAN','PROGRESSIVE_PLAN','MANUSCRIPT','USER')),
  source_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_chapter_index integer NOT NULL DEFAULT 0 CHECK (effective_chapter_index >= 0),
  retrieval_tags text[] NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_active boolean NOT NULL DEFAULT true,
  supersedes_id uuid REFERENCES public.narrative_exact_anchors(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, anchor_key, version)
);
CREATE UNIQUE INDEX narrative_exact_anchors_one_active ON public.narrative_exact_anchors(book_id, anchor_key) WHERE is_active;
CREATE INDEX narrative_exact_anchors_lookup ON public.narrative_exact_anchors(book_id, is_active, effective_chapter_index);
GRANT SELECT ON public.narrative_exact_anchors TO authenticated;
GRANT ALL ON public.narrative_exact_anchors TO service_role;
ALTER TABLE public.narrative_exact_anchors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read exact anchors" ON public.narrative_exact_anchors FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.protect_anchor_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.exact_text IS DISTINCT FROM OLD.exact_text OR NEW.anchor_key IS DISTINCT FROM OLD.anchor_key
     OR NEW.version IS DISTINCT FROM OLD.version OR NEW.book_id IS DISTINCT FROM OLD.book_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.anchor_type IS DISTINCT FROM OLD.anchor_type THEN
    RAISE EXCEPTION 'Anchor text is immutable; create a new version.';
  END IF;
  IF OLD.is_active = false AND NEW.is_active = true THEN RAISE EXCEPTION 'Retired anchors cannot be reactivated.'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_protect_anchor_immutability BEFORE UPDATE ON public.narrative_exact_anchors
  FOR EACH ROW EXECUTE FUNCTION public.protect_anchor_immutability();

-- Atomic versioning: retire the active version and insert the next one in one transaction.
CREATE OR REPLACE FUNCTION public.upsert_exact_anchor(p_book_id uuid, p_user_id uuid, p_key text, p_type text, p_text text, p_match text, p_source_type text, p_source_ref jsonb, p_chapter integer, p_context text DEFAULT '', p_tags text[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur narrative_exact_anchors%ROWTYPE; new_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM books WHERE id = p_book_id AND user_id = p_user_id) THEN RAISE EXCEPTION 'book not owned by user'; END IF;
  SELECT * INTO cur FROM narrative_exact_anchors WHERE book_id=p_book_id AND anchor_key=p_key AND is_active FOR UPDATE;
  IF FOUND AND cur.exact_text = p_text AND cur.match_mode = p_match THEN
    RETURN jsonb_build_object('status','unchanged','anchor_id',cur.id,'version',cur.version);
  END IF;
  IF FOUND THEN UPDATE narrative_exact_anchors SET is_active=false WHERE id=cur.id; END IF;
  INSERT INTO narrative_exact_anchors(book_id,user_id,anchor_key,anchor_type,exact_text,match_mode,context_hint,source_type,source_ref,effective_chapter_index,retrieval_tags,version,supersedes_id)
    VALUES (p_book_id,p_user_id,p_key,p_type,p_text,p_match,coalesce(p_context,''),p_source_type,coalesce(p_source_ref,'{}'::jsonb),p_chapter,coalesce(p_tags,'{}'),
            CASE WHEN cur.id IS NULL THEN 1 ELSE cur.version+1 END, cur.id)
    RETURNING id INTO new_id;
  RETURN jsonb_build_object('status', CASE WHEN cur.id IS NULL THEN 'created' ELSE 'versioned' END, 'anchor_id', new_id);
END $$;

-- 3. Canon reconciliation logs: auditable contradiction + explicit author decision.
CREATE TABLE public.canon_reconciliation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  chapter_index integer NOT NULL CHECK (chapter_index >= 0),
  subsection_index integer NOT NULL CHECK (subsection_index >= 0),
  severity text NOT NULL CHECK (severity IN ('CRITICAL','MAJOR','MINOR')),
  discrepancy_type text NOT NULL CHECK (discrepancy_type IN ('PLAN_DEVIATION','CANON_CONFLICT','ANCHOR_MISMATCH','TIMELINE','IDENTITY','OTHER')),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 4000),
  prose_excerpt text NOT NULL DEFAULT '',
  canon_reference jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  dedup_key text NOT NULL,
  decision text NOT NULL DEFAULT 'PENDING' CHECK (decision IN ('PENDING','KEEP_CANON_REVISE_PROSE','ACCEPT_PROSE_UPDATE_CANON','DISMISS')),
  rationale text,
  resulting_changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  replan_required boolean NOT NULL DEFAULT false,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, dedup_key),
  CHECK (decision = 'PENDING' OR (decided_at IS NOT NULL AND decided_by IS NOT NULL AND rationale IS NOT NULL AND char_length(btrim(rationale)) > 0))
);
CREATE INDEX canon_reconciliation_logs_pending ON public.canon_reconciliation_logs(book_id, decision, chapter_index);
GRANT SELECT ON public.canon_reconciliation_logs TO authenticated;
GRANT ALL ON public.canon_reconciliation_logs TO service_role;
ALTER TABLE public.canon_reconciliation_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read reconciliation logs" ON public.canon_reconciliation_logs FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Evidence is append-only; a decision is recorded once and is final.
CREATE OR REPLACE FUNCTION public.protect_reconciliation_log()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.book_id IS DISTINCT FROM OLD.book_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.description IS DISTINCT FROM OLD.description OR NEW.prose_excerpt IS DISTINCT FROM OLD.prose_excerpt
     OR NEW.canon_reference IS DISTINCT FROM OLD.canon_reference OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.severity IS DISTINCT FROM OLD.severity OR NEW.discrepancy_type IS DISTINCT FROM OLD.discrepancy_type
     OR NEW.chapter_index IS DISTINCT FROM OLD.chapter_index OR NEW.subsection_index IS DISTINCT FROM OLD.subsection_index
     OR NEW.dedup_key IS DISTINCT FROM OLD.dedup_key THEN
    RAISE EXCEPTION 'Reconciliation evidence is immutable.';
  END IF;
  IF OLD.decision <> 'PENDING' THEN RAISE EXCEPTION 'Reconciliation decision already recorded.'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_protect_reconciliation_log BEFORE UPDATE ON public.canon_reconciliation_logs
  FOR EACH ROW EXECUTE FUNCTION public.protect_reconciliation_log();
CREATE OR REPLACE FUNCTION public.block_reconciliation_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_setting('app.allow_reconciliation_cascade', true) IS DISTINCT FROM 'true'
     AND EXISTS (SELECT 1 FROM books WHERE id = OLD.book_id) THEN
    RAISE EXCEPTION 'Reconciliation logs are append-only.';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_block_reconciliation_delete BEFORE DELETE ON public.canon_reconciliation_logs
  FOR EACH ROW EXECUTE FUNCTION public.block_reconciliation_delete();

-- Server records a contradiction (idempotent on dedup_key).
CREATE OR REPLACE FUNCTION public.record_canon_discrepancy(p_book_id uuid, p_user_id uuid, p_chapter integer, p_sub integer, p_severity text, p_type text, p_description text, p_excerpt text, p_canon_ref jsonb, p_content_hash text, p_dedup_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM books WHERE id = p_book_id AND user_id = p_user_id) THEN RAISE EXCEPTION 'book not owned by user'; END IF;
  INSERT INTO canon_reconciliation_logs(book_id,user_id,chapter_index,subsection_index,severity,discrepancy_type,description,prose_excerpt,canon_reference,content_hash,dedup_key)
    VALUES (p_book_id,p_user_id,p_chapter,p_sub,p_severity,p_type,p_description,coalesce(p_excerpt,''),coalesce(p_canon_ref,'{}'::jsonb),p_content_hash,p_dedup_key)
    ON CONFLICT (book_id, dedup_key) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM canon_reconciliation_logs WHERE book_id=p_book_id AND dedup_key=p_dedup_key;
    RETURN jsonb_build_object('status','duplicate','log_id',v_id);
  END IF;
  RETURN jsonb_build_object('status','recorded','log_id',v_id);
END $$;

-- Author records a decision. Callable by the signed-in owner only; identity comes from auth.uid().
CREATE OR REPLACE FUNCTION public.decide_canon_reconciliation(p_log_id uuid, p_decision text, p_rationale text, p_resulting_changes jsonb DEFAULT '[]'::jsonb, p_replan boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r canon_reconciliation_logs%ROWTYPE; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_decision NOT IN ('KEEP_CANON_REVISE_PROSE','ACCEPT_PROSE_UPDATE_CANON','DISMISS') THEN RAISE EXCEPTION 'invalid decision'; END IF;
  IF p_rationale IS NULL OR char_length(btrim(p_rationale)) = 0 THEN RAISE EXCEPTION 'rationale required'; END IF;
  SELECT * INTO r FROM canon_reconciliation_logs WHERE id = p_log_id FOR UPDATE;
  IF NOT FOUND OR r.user_id <> v_uid THEN RAISE EXCEPTION 'not found'; END IF;
  IF r.decision <> 'PENDING' THEN RETURN jsonb_build_object('status','already_decided','decision',r.decision); END IF;
  UPDATE canon_reconciliation_logs SET decision=p_decision, rationale=btrim(p_rationale), resulting_changes=coalesce(p_resulting_changes,'[]'::jsonb),
    replan_required=coalesce(p_replan,false) OR p_decision='ACCEPT_PROSE_UPDATE_CANON', decided_by=v_uid, decided_at=now() WHERE id=p_log_id;
  RETURN jsonb_build_object('status','decided','decision',p_decision);
END $$;

-- Lock down execution: server functions are service-role only; decide is owner (authenticated) only.
REVOKE ALL ON FUNCTION public.acquire_generation_lease(uuid,uuid,integer,integer,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_generation_lease(uuid,text,bigint,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_generation_lease(uuid,text,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_generation_fence(uuid,integer,integer,text,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_exact_anchor(uuid,uuid,text,text,text,text,text,jsonb,integer,text,text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_canon_discrepancy(uuid,uuid,integer,integer,text,text,text,text,jsonb,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decide_canon_reconciliation(uuid,text,text,jsonb,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acquire_generation_lease(uuid,uuid,integer,integer,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_generation_lease(uuid,text,bigint,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_generation_lease(uuid,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.assert_generation_fence(uuid,integer,integer,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_exact_anchor(uuid,uuid,text,text,text,text,text,jsonb,integer,text,text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_canon_discrepancy(uuid,uuid,integer,integer,text,text,text,text,jsonb,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_canon_reconciliation(uuid,text,text,jsonb,boolean) TO authenticated, service_role;