create table public.identity_entities (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null, user_id uuid not null,
  kind text not null, name text not null, aliases text[] not null default '{}',
  introduced_position bigint not null default 0,
  created_at timestamptz not null default now()
);
create table public.identity_attribute_versions (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.identity_entities(id) on delete cascade,
  book_id uuid not null, user_id uuid not null,
  attribute text not null, value text not null, effective_position bigint not null,
  authority text not null check (authority in ('USER_CANON','OUTLINE_CANON','APPROVED_GENERATED_STATE','AI_INFERENCE')),
  source text not null check (length(btrim(source))>0),
  evidence text not null check (length(btrim(evidence))>0),
  source_section_key text not null,
  commit_id uuid,
  created_at timestamptz not null default now()
);
create table public.identity_commits (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null, user_id uuid not null,
  section_id text not null, content_hash text not null,
  purpose text not null, schema_version int not null,
  extraction_id text,
  created_at timestamptz not null default now(),
  unique (book_id, section_id, content_hash, purpose, schema_version)
);
create index on public.identity_attribute_versions(entity_id, attribute, effective_position);
alter table public.identity_entities enable row level security;
alter table public.identity_attribute_versions enable row level security;
alter table public.identity_commits enable row level security;
create policy "own entities read" on public.identity_entities for select to authenticated using (user_id = auth.uid());
create policy "own versions read" on public.identity_attribute_versions for select to authenticated using (user_id = auth.uid());
create policy "own commits read" on public.identity_commits for select to authenticated using (user_id = auth.uid());
grant select on public.identity_entities, public.identity_attribute_versions, public.identity_commits to authenticated;
grant all on public.identity_entities, public.identity_attribute_versions, public.identity_commits to service_role;

-- All-or-nothing, idempotent batch commit. A plpgsql function body runs in one
-- transaction: any raised error rolls back every mutation in the batch.
create or replace function public.commit_identity_batch(
  p_book_id uuid, p_user_id uuid, p_section_id text, p_content_hash text,
  p_purpose text, p_schema_version int, p_extraction_id text, p_changes jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb; v_commit uuid; v_prior record; n int := 0;
begin
  select id into v_commit from identity_commits where book_id=p_book_id and section_id=p_section_id
    and content_hash=p_content_hash and purpose=p_purpose and schema_version=p_schema_version;
  if v_commit is not null then return jsonb_build_object('status','duplicate','commit_id',v_commit,'applied',0); end if;
  insert into identity_commits(book_id,user_id,section_id,content_hash,purpose,schema_version,extraction_id)
    values (p_book_id,p_user_id,p_section_id,p_content_hash,p_purpose,p_schema_version,p_extraction_id) returning id into v_commit;
  for c in select * from jsonb_array_elements(p_changes) loop
    if not exists (select 1 from identity_entities where id=(c->>'entity_id')::uuid and book_id=p_book_id) then
      raise exception 'unknown entity %', c->>'entity_id';
    end if;
    select value, authority into v_prior from identity_attribute_versions
      where entity_id=(c->>'entity_id')::uuid and attribute=c->>'attribute' and effective_position <= (c->>'position')::bigint
      order by effective_position desc, created_at desc limit 1;
    if found and lower(btrim(v_prior.value)) = lower(btrim(c->>'value')) then continue; end if;
    if found and (case v_prior.authority when 'USER_CANON' then 4 when 'OUTLINE_CANON' then 3 when 'APPROVED_GENERATED_STATE' then 2 else 1 end)
               > (case c->>'authority' when 'USER_CANON' then 4 when 'OUTLINE_CANON' then 3 when 'APPROVED_GENERATED_STATE' then 2 else 1 end) then
      raise exception 'authority inversion on %.%', c->>'entity_id', c->>'attribute';
    end if;
    insert into identity_attribute_versions(entity_id,book_id,user_id,attribute,value,effective_position,authority,source,evidence,source_section_key,commit_id)
      values ((c->>'entity_id')::uuid,p_book_id,p_user_id,c->>'attribute',c->>'value',(c->>'position')::bigint,c->>'authority',
              coalesce(c->>'source',''),coalesce(c->>'evidence',''),p_section_id,v_commit);
    n := n + 1;
  end loop;
  return jsonb_build_object('status','committed','commit_id',v_commit,'applied',n);
end $$;
revoke all on function public.commit_identity_batch(uuid,uuid,text,text,text,int,text,jsonb) from public, anon, authenticated;
grant execute on function public.commit_identity_batch(uuid,uuid,text,text,text,int,text,jsonb) to service_role;