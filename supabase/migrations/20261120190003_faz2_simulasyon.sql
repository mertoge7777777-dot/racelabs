-- Simülasyon Günü / antrenman / test oturumları, ara süreler, canlı sıralama, istasyon geçmişi ve yarış tahmini.
-- Ara süre satırının kimliğini istemci üretir (UUID): ağ koparsa tekrar gönderilir, çift kayıt olmaz.

alter table public.athletes add column share_results boolean not null default true;

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  kind text not null check (kind in ('simulation', 'training', 'test', 'race')),
  title text not null check (char_length(btrim(title)) between 2 and 120),
  config_version_id uuid references public.race_config_versions(id),
  track_roxzone boolean not null default true,
  status text not null default 'planned' check (status in ('planned', 'live', 'finished', 'cancelled')),
  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  notes text check (char_length(notes) <= 2000),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (kind not in ('simulation', 'race') or config_version_id is not null)
);
create index sessions_org_idx on public.sessions(org_id, created_at desc);

create table public.session_entries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  display_name text not null,
  division_code text check (division_code ~ '^[a-z0-9_]{2,40}$'),
  bib int check (bib between 1 and 9999),
  wave int not null default 1 check (wave between 1 and 50),
  status text not null default 'registered' check (status in ('registered', 'running', 'finished', 'dnf', 'dq')),
  started_at timestamptz,
  finished_at timestamptz,
  total_ms bigint check (total_ms between 1000 and 36000000),
  created_at timestamptz not null default now(),
  unique (session_id, athlete_id)
);
create index entries_session_idx on public.session_entries(session_id);
create index entries_athlete_idx on public.session_entries(athlete_id);

create table public.segments (
  id uuid primary key,
  entry_id uuid not null references public.session_entries(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  segment_index int not null check (segment_index between 1 and 80),
  kind text not null check (kind in ('run', 'roxzone', 'station')),
  ref_code text not null check (ref_code ~ '^[a-z0-9_]{2,40}$'),
  duration_ms int not null check (duration_ms between 500 and 10800000),
  ended_at timestamptz,
  load_kg numeric(6,2) check (load_kg between 0 and 500),
  reps int check (reps between 0 and 1000),
  hr_avg int check (hr_avg between 30 and 240),
  rpe numeric(3,1) check (rpe between 0 and 10),
  source text not null default 'timer' check (source in ('timer', 'manual', 'import')),
  is_estimate boolean not null default false,
  note text check (char_length(note) <= 500),
  recorded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (entry_id, segment_index)
);
create index segments_entry_idx on public.segments(entry_id, segment_index);

-- org_id tutarlılığı: istemci başka salonun kimliğini yazamaz
create or replace function app.fill_org() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'session_entries' then
    select s.org_id into new.org_id from public.sessions s where s.id = new.session_id;
    if not exists (select 1 from public.athletes a where a.id = new.athlete_id and a.org_id = new.org_id) then
      raise exception 'Sporcu bu salona ait değil';
    end if;
    if tg_op = 'INSERT' and (new.display_name is null or btrim(new.display_name) = '') then
      select a.display_name into new.display_name from public.athletes a where a.id = new.athlete_id;
    end if;
  elsif tg_table_name = 'segments' then
    select e.org_id into new.org_id from public.session_entries e where e.id = new.entry_id;
  end if;
  if new.org_id is null then raise exception 'Bağlı kayıt bulunamadı'; end if;
  return new;
end; $$;
create trigger entries_fill before insert or update on public.session_entries for each row execute function app.fill_org();
create trigger segments_fill before insert or update on public.segments for each row execute function app.fill_org();

create or replace function app.can_record(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role(p_org, array['owner', 'coach', 'judge']) or app.is_platform_admin();
$$;
grant execute on function app.can_record(uuid) to authenticated;

create trigger sessions_audit after insert or update or delete on public.sessions for each row execute function app.audit();
create trigger entries_audit after insert or update or delete on public.session_entries for each row execute function app.audit();

alter table public.sessions enable row level security;
alter table public.session_entries enable row level security;
alter table public.segments enable row level security;

-- Okuma: salonun tüm üyeleri (sporcu kendi salonunun sıralamasını görür; isim gizliliği sıralama fonksiyonunda).
-- Sporcu ham satırlarda yalnız KENDİ kaydını görür; başkalarını session_leaderboard() ile görür.
create policy ses_select on public.sessions for select to authenticated using (app.is_member(org_id) or app.is_platform_admin());
create policy ses_insert on public.sessions for insert to authenticated with check (app.is_staff(org_id));
create policy ses_update on public.sessions for update to authenticated using (app.can_record(org_id)) with check (app.can_record(org_id));
create policy ses_delete on public.sessions for delete to authenticated using (app.has_role(org_id, array['owner']));

create policy ent_select on public.session_entries for select to authenticated using (
  app.can_record(org_id) or exists (select 1 from public.athletes a where a.id = athlete_id and a.user_id = (select auth.uid()))
);
create policy ent_insert on public.session_entries for insert to authenticated with check (app.is_staff(org_id));
create policy ent_update on public.session_entries for update to authenticated using (app.can_record(org_id)) with check (app.can_record(org_id));
create policy ent_delete on public.session_entries for delete to authenticated using (app.is_staff(org_id));

create policy seg_select on public.segments for select to authenticated using (
  app.can_record(org_id) or exists (
    select 1 from public.session_entries e join public.athletes a on a.id = e.athlete_id
    where e.id = entry_id and a.user_id = (select auth.uid())
  )
);
create policy seg_insert on public.segments for insert to authenticated with check (app.can_record(org_id));
create policy seg_update on public.segments for update to authenticated using (app.can_record(org_id)) with check (app.can_record(org_id));
create policy seg_delete on public.segments for delete to authenticated using (app.can_record(org_id));

grant select, insert, update, delete on public.sessions, public.session_entries, public.segments to authenticated;

-- Canlı sıralama: salon üyeleri görür; sonuç paylaşmayan sporcunun adı "Sporcu #numara" olur.
create or replace function public.session_leaderboard(p_session uuid)
returns table (entry_id uuid, name text, division_code text, bib int, wave int, status text,
               segments_done int, last_ref text, elapsed_ms bigint, total_ms bigint, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid;
begin
  select s.org_id into v_org from public.sessions s where s.id = p_session;
  if v_org is null or not (app.is_member(v_org) or app.is_platform_admin()) then raise exception 'Yetki yok'; end if;
  return query
  select e.id,
         case when a.share_results or a.user_id = (select auth.uid()) or app.can_record(v_org)
              then e.display_name else 'Sporcu #' || coalesce(e.bib::text, '?') end,
         e.division_code, e.bib, e.wave, e.status,
         coalesce(sg.n, 0)::int, sg.last_ref, coalesce(sg.ms, 0)::bigint, e.total_ms,
         (a.user_id = (select auth.uid()))
  from public.session_entries e
  join public.athletes a on a.id = e.athlete_id
  left join lateral (
    select count(*) as n, sum(x.duration_ms) as ms,
           (array_agg(x.ref_code order by x.segment_index desc))[1] as last_ref
    from public.segments x where x.entry_id = e.id
  ) sg on true
  where e.session_id = p_session
  order by case e.status when 'finished' then 0 when 'running' then 1 when 'registered' then 2 else 3 end,
           coalesce(sg.n, 0) desc, coalesce(e.total_ms, sg.ms) asc nulls last, e.bib nulls last;
end; $$;

-- Sporcunun istasyon/koşu geçmişi: en iyi, son, ortanca, sayı (yalnız aynı ölçüt kodu karşılaştırılır).
create or replace function public.athlete_segment_stats(p_athlete uuid)
returns table (ref_code text, kind text, n int, best_ms int, last_ms int, median_ms int, last_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_user uuid;
begin
  select a.org_id, a.user_id into v_org, v_user from public.athletes a where a.id = p_athlete;
  if v_org is null or not (app.is_staff(v_org) or app.can_record(v_org) or v_user = (select auth.uid())) then raise exception 'Yetki yok'; end if;
  return query
  select s.ref_code, min(s.kind), count(*)::int, min(s.duration_ms)::int,
         (array_agg(s.duration_ms order by coalesce(s.ended_at, s.created_at) desc))[1]::int,
         (percentile_cont(0.5) within group (order by s.duration_ms))::int,
         max(coalesce(s.ended_at, s.created_at))
  from public.segments s join public.session_entries e on e.id = s.entry_id
  where e.athlete_id = p_athlete and not s.is_estimate
  group by s.ref_code;
end; $$;

-- Yarış tahmini v1 (açıklanabilir): her bölüm için son 3 ölçümden
--   iyimser = en iyi, gerçekçi = ortanca, kötümser = en kötü x 1,03 (yorgunluk payı).
-- Eksik bölüm varsa toplam VERİLMEZ; eksikler listelenir. Garanti değildir.
create or replace function public.predict_race(p_athlete uuid, p_config_version uuid, p_track_roxzone boolean default true)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_user uuid; pl jsonb; st jsonb; i int; runs int; parts jsonb := '[]'; missing text[] := '{}';
        o bigint := 0; r bigint := 0; p bigint := 0; used int := 0; total_n int := 0; code text; k text;
        b int; m int; w int; n int; conf text; newest timestamptz := null; t timestamptz;
begin
  select a.org_id, a.user_id into v_org, v_user from public.athletes a where a.id = p_athlete;
  if v_org is null or not (app.is_staff(v_org) or v_user = (select auth.uid())) then raise exception 'Yetki yok'; end if;
  select v.payload into pl from public.race_config_versions v where v.id = p_config_version and app.can_see_config(v.config_id);
  if pl is null then raise exception 'Format bulunamadı'; end if;
  runs := coalesce((pl->'runs'->>'count')::int, 0);
  for i in 1 .. greatest(jsonb_array_length(pl->'stations'), runs) loop
    for k in select unnest(array['run', 'roxzone', 'station']) loop
      if k = 'run' and i > runs then continue; end if;
      if k = 'roxzone' and (not p_track_roxzone or i > jsonb_array_length(pl->'stations')) then continue; end if;
      if k = 'station' and i > jsonb_array_length(pl->'stations') then continue; end if;
      code := case k when 'run' then 'run_' || i when 'roxzone' then 'roxzone_' || i else (pl->'stations'->(i - 1)->>'code') end;
      total_n := total_n + 1;
      select min(d), (percentile_cont(0.5) within group (order by d))::int, max(d), count(*), max(at)
        into b, m, w, n, t
      from (
        select s.duration_ms d, coalesce(s.ended_at, s.created_at) at
        from public.segments s join public.session_entries e on e.id = s.entry_id
        where e.athlete_id = p_athlete and s.ref_code = code and not s.is_estimate
        order by coalesce(s.ended_at, s.created_at) desc limit 3
      ) q;
      if coalesce(n, 0) = 0 then
        missing := missing || code;
      else
        used := used + 1;
        o := o + b; r := r + m; p := p + round(w * 1.03);
        if newest is null or t > newest then newest := t; end if;
        parts := parts || jsonb_build_object('ref', code, 'kind', k, 'n', n, 'best_ms', b, 'median_ms', m, 'worst_ms', w);
      end if;
    end loop;
  end loop;
  conf := case when array_length(missing, 1) > 0 then 'yetersiz'
               when (select min((x->>'n')::int) from jsonb_array_elements(parts) x) >= 3 then 'orta'
               else 'dusuk' end;
  return jsonb_build_object(
    'complete', coalesce(array_length(missing, 1), 0) = 0,
    'optimistic_ms', case when coalesce(array_length(missing, 1), 0) = 0 then o end,
    'realistic_ms', case when coalesce(array_length(missing, 1), 0) = 0 then r end,
    'pessimistic_ms', case when coalesce(array_length(missing, 1), 0) = 0 then p end,
    'partial_realistic_ms', r, 'segments_used', used, 'segments_total', total_n,
    'missing', to_jsonb(missing), 'confidence', conf, 'newest_data_at', newest, 'parts', parts,
    'method', 'v1: bölüm başına son 3 ölçüm; iyimser=en iyi, gerçekçi=ortanca, kötümser=en kötü×1,03. Tahmindir, garanti değildir.'
  );
end; $$;

revoke execute on function public.session_leaderboard(uuid), public.athlete_segment_stats(uuid), public.predict_race(uuid, uuid, boolean) from public, anon;
grant execute on function public.session_leaderboard(uuid), public.athlete_segment_stats(uuid), public.predict_race(uuid, uuid, boolean) to authenticated;

-- Supabase Realtime (yerel testte yayın yoksa atlanır)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.segments, public.session_entries, public.sessions;
  end if;
end $$;
