-- Bağımsız denetim (21.11.2026) bulgularının düzeltmeleri.

-- Y2: Salon sahibi yalnız salon ADINI değiştirebilir; plan (deneme/aktif/askıda) yalnız platform yönetiminde.
revoke update on public.orgs from authenticated;
grant update (name) on public.orgs to authenticated;

-- O1: Üyelik satırları doğrudan değiştirilemez; rol değişikliği yalnız set_member_role() ile.
revoke update on public.org_members from authenticated;
drop policy if exists om_update on public.org_members;

-- O2: KVKK onayı kanıttır: yalnız geri çekme zamanı (revoked_at) yazılabilir, o da bir kez.
revoke update on public.consents from authenticated;
grant update (revoked_at) on public.consents to authenticated;
create or replace function app.consents_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.revoked_at is not null then raise exception 'Geri çekilmiş onay değiştirilemez'; end if;
  if new.revoked_at is null then raise exception 'Yalnız onayı geri çekebilirsiniz'; end if;
  new.revoked_at := now();
  return new;
end; $$;
create trigger consents_guard before update on public.consents for each row execute function app.consents_guard();

-- Y1: Formatın salonu ve kodu değiştirilemez (salon formatını "platform formatı" yapma engeli).
create or replace function app.rc_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.org_id is distinct from old.org_id or new.code is distinct from old.code or new.created_by is distinct from old.created_by then
    raise exception 'Formatın salonu/kodu değiştirilemez';
  end if;
  return new;
end; $$;
create trigger rc_guard before update on public.race_configs for each row execute function app.rc_guard();
revoke update on public.race_configs from authenticated;
grant update (name, season, status) on public.race_configs to authenticated;

-- O3: Antrenör notu ayrı tabloda; sporcu ne API'den ne değişiklik geçmişinden okuyabilir.
create table public.athlete_coach_notes (
  athlete_id uuid primary key references public.athletes(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  notes text not null default '' check (char_length(notes) <= 4000),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
insert into public.athlete_coach_notes (athlete_id, org_id, notes)
select id, org_id, coach_notes from public.athletes where coalesce(coach_notes, '') <> '';
update public.athlete_profile_history set old_values = old_values - 'coach_notes', new_values = new_values - 'coach_notes';
delete from public.athlete_profile_history where old_values = '{}'::jsonb and new_values = '{}'::jsonb;

create or replace function app.coach_notes_fill() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select a.org_id into new.org_id from public.athletes a where a.id = new.athlete_id;
  if new.org_id is null then raise exception 'Sporcu bulunamadı'; end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end; $$;
create trigger coach_notes_fill before insert or update on public.athlete_coach_notes for each row execute function app.coach_notes_fill();
alter table public.athlete_coach_notes enable row level security;
create policy acn_all on public.athlete_coach_notes for all to authenticated using (app.is_staff(org_id)) with check (app.is_staff(org_id));
grant select, insert, update, delete on public.athlete_coach_notes to authenticated;

-- athletes_guard: koç notu sütunu kalkıyor; sporcu kaydını başka bir kullanıcıya bağlama yalnız sistem işlemleriyle
-- (join_org) olur; servis/yönetim betikleri (auth.uid() yok) kontrollerden muaf.
create or replace function app.athletes_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id then raise exception 'Sporcunun salonu değiştirilemez'; end if;
    if auth.uid() is not null then
      if new.user_id is distinct from old.user_id then raise exception 'Sporcu hesabı bağlantısı değiştirilemez'; end if;
      if new.mergesport_user_id is distinct from old.mergesport_user_id and not app.is_staff(old.org_id) then
        raise exception 'Bu alanı yalnız antrenör değiştirebilir';
      end if;
    end if;
    insert into public.athlete_profile_history (athlete_id, org_id, old_values, new_values)
    select old.id, old.org_id,
           coalesce(jsonb_object_agg(o.key, o.value) filter (where o.value is distinct from n.value), '{}'::jsonb),
           coalesce(jsonb_object_agg(n.key, n.value) filter (where o.value is distinct from n.value), '{}'::jsonb)
    from jsonb_each(to_jsonb(old) - 'updated_at') o
    join jsonb_each(to_jsonb(new) - 'updated_at') n using (key);
  end if;
  return new;
end; $$;
alter table public.athletes drop column coach_notes;

-- Personel yeni sporcu eklerken kaydı bir kullanıcı hesabına bağlayamaz (bağlantı yalnız join_org ile).
drop policy if exists ath_insert on public.athletes;
create policy ath_insert on public.athletes for insert to authenticated with check (app.is_staff(org_id) and user_id is null);

-- O5: Rol değişince sporcu verisi SİLİNMEZ. Antrenör/hakem olan kişinin sporcu kaydı listelerde gizlenir (arayüz),
-- tekrar sporcu yapılınca aynı kayıt geri gelir. E-posta öneki salona sızdırılmaz.
create or replace function public.set_member_role(p_org uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_role(p_org, array['owner']) then raise exception 'Yalnız salon sahibi'; end if;
  if p_role not in ('coach', 'athlete', 'judge') then raise exception 'Geçersiz rol'; end if;
  if p_user = auth.uid() then raise exception 'Kendi rolünüzü değiştiremezsiniz'; end if;
  update public.org_members set role = p_role where org_id = p_org and user_id = p_user and role <> 'owner';
  if not found then raise exception 'Üye bulunamadı'; end if;
  if p_role = 'athlete' and not exists (select 1 from public.athletes where org_id = p_org and user_id = p_user) then
    insert into public.athletes (org_id, user_id, display_name, created_by) values (p_org, p_user, 'Yeni sporcu', auth.uid());
  end if;
end; $$;

-- Taslak sürümler yalnız yöneticisi tarafından tahminde/kopyalamada kullanılabilir.
create or replace function app.can_use_version(p_version uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.race_config_versions v where v.id = p_version and app.can_see_config(v.config_id)
                 and (v.status = 'published' or app.can_manage_config(v.config_id)));
$$;
grant execute on function app.can_use_version(uuid) to authenticated;

create or replace function public.copy_race_config_to_org(p_version uuid, p_org uuid, p_code text, p_name text) returns public.race_configs
language plpgsql security definer set search_path = '' as $$
declare src public.race_config_versions; c public.race_configs;
begin
  if not app.has_role(p_org, array['owner']) then raise exception 'Yalnız salon sahibi'; end if;
  if not app.can_use_version(p_version) then raise exception 'Kaynak bulunamadı'; end if;
  select * into src from public.race_config_versions where id = p_version;
  insert into public.race_configs (org_id, code, name, season) values (p_org, p_code, p_name, (select season from public.race_configs where id = src.config_id)) returning * into c;
  insert into public.race_config_versions (config_id, version, payload, source_url) values (c.id, 1, src.payload, src.source_url);
  return c;
end; $$;

-- predict_race: yalnız kullanılabilir sürüm; koşu/istasyon sayısı üst sınırlı.
create or replace function public.predict_race(p_athlete uuid, p_config_version uuid, p_track_roxzone boolean default true)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_user uuid; pl jsonb; i int; runs int; nst int; parts jsonb := '[]'; missing text[] := '{}';
        o bigint := 0; r bigint := 0; p bigint := 0; used int := 0; total_n int := 0; code text; k text;
        b int; m int; w int; n int; conf text; newest timestamptz := null; t timestamptz;
begin
  select a.org_id, a.user_id into v_org, v_user from public.athletes a where a.id = p_athlete;
  if v_org is null or not (app.is_staff(v_org) or v_user = (select auth.uid())) then raise exception 'Yetki yok'; end if;
  if not app.can_use_version(p_config_version) then raise exception 'Format bulunamadı'; end if;
  select v.payload into pl from public.race_config_versions v where v.id = p_config_version;
  runs := least(greatest(coalesce((pl->'runs'->>'count')::int, 0), 0), 20);
  nst := least(coalesce(jsonb_array_length(pl->'stations'), 0), 12);
  for i in 1 .. greatest(nst, runs) loop
    for k in select unnest(array['run', 'roxzone', 'station']) loop
      if k = 'run' and i > runs then continue; end if;
      if k = 'roxzone' and (not p_track_roxzone or i > nst) then continue; end if;
      if k = 'station' and i > nst then continue; end if;
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

-- O4: Cihazlar arası saat farkı: istemci sunucu saatini öğrenip farkı düzeltir.
create or replace function public.server_now() returns timestamptz language sql stable as $$ select now(); $$;
revoke execute on function public.server_now() from public, anon;
grant execute on function public.server_now() to authenticated;
