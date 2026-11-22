-- RaceLab (HYROX LAB) FAZ 1 — çekirdek şema: salon, üyelik/rol, sporcu profili, KVKK onayı, denetim kaydı.
-- Kural: her tabloda RLS açık; yetki veritabanında uygulanır (arayüzde gizlemeye güvenilmez).

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, anon;

-- ---------------------------------------------------------------- tablolar
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  join_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  plan text not null default 'deneme' check (plan in ('deneme', 'aktif', 'askida')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'coach', 'athlete', 'judge')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_idx on public.org_members(user_id);

create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  mergesport_user_id bigint,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 80),
  birth_year int check (birth_year between 1920 and 2025),
  sex text check (sex in ('F', 'M', 'X')),
  height_cm numeric(5,1) check (height_cm between 100 and 250),
  weight_kg numeric(5,1) check (weight_kg between 25 and 300),
  training_age_years numeric(4,1) check (training_age_years between 0 and 80),
  sport_background text check (char_length(sport_background) <= 500),
  hyrox_experience text check (hyrox_experience in ('yok', 'ilk_yaris', '1_3_yaris', '4_plus')),
  division text check (char_length(division) <= 40),
  goals text check (char_length(goals) <= 1000),
  limitations text check (char_length(limitations) <= 1000),
  coach_notes text check (char_length(coach_notes) <= 4000),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index athletes_org_idx on public.athletes(org_id);
create index athletes_user_idx on public.athletes(user_id);

create table public.athlete_profile_history (
  id bigint generated always as identity primary key,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now(),
  old_values jsonb not null,
  new_values jsonb not null
);
create index aph_athlete_idx on public.athlete_profile_history(athlete_id, changed_at desc);

create table public.consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  org_id uuid references public.orgs(id) on delete cascade,
  kind text not null check (kind in ('kvkk_aydinlatma', 'kvkk_acik_riza_saglik', 'veli_onayi')),
  text_version text not null check (char_length(text_version) between 1 and 40),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index consents_user_idx on public.consents(user_id);

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid default auth.uid(),
  org_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb
);
create index audit_org_idx on public.audit_log(org_id, at desc);

-- ---------------------------------------------------------------- yardımcı fonksiyonlar (RLS içinde özyineleme olmasın diye security definer)
create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins p where p.user_id = (select auth.uid()));
$$;

create or replace function app.has_role(p_org uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = any (p_roles)
  );
$$;

create or replace function app.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role(p_org, array['owner', 'coach', 'athlete', 'judge']);
$$;

create or replace function app.is_staff(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role(p_org, array['owner', 'coach']) or app.is_platform_admin();
$$;

grant execute on function app.is_platform_admin(), app.has_role(uuid, text[]), app.is_member(uuid), app.is_staff(uuid) to authenticated;

-- ---------------------------------------------------------------- tetikleyiciler
create or replace function app.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;

create trigger orgs_touch before update on public.orgs for each row execute function app.touch_updated_at();
create trigger athletes_touch before update on public.athletes for each row execute function app.touch_updated_at();

-- Sporcu kendi profilini düzenleyebilir ama koç notunu, salonunu ve hesabını değiştiremez.
create or replace function app.athletes_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id then raise exception 'Sporcunun salonu değiştirilemez'; end if;
    if not app.is_staff(old.org_id) then
      if new.coach_notes is distinct from old.coach_notes
         or new.user_id is distinct from old.user_id
         or new.mergesport_user_id is distinct from old.mergesport_user_id then
        raise exception 'Bu alanı yalnız antrenör değiştirebilir';
      end if;
    end if;
    -- Geçmiş korunur: eski ve yeni değerler (yalnız değişen alanlar) kaydedilir.
    insert into public.athlete_profile_history (athlete_id, org_id, old_values, new_values)
    select old.id, old.org_id,
           coalesce(jsonb_object_agg(o.key, o.value) filter (where o.value is distinct from n.value), '{}'::jsonb),
           coalesce(jsonb_object_agg(n.key, n.value) filter (where o.value is distinct from n.value), '{}'::jsonb)
    from jsonb_each(to_jsonb(old) - 'updated_at') o
    join jsonb_each(to_jsonb(new) - 'updated_at') n using (key);
  end if;
  return new;
end; $$;
create trigger athletes_guard before update on public.athletes for each row execute function app.athletes_guard();

create or replace function app.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_org uuid;
begin
  r := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_org := case when tg_table_name = 'orgs' then (r->>'id')::uuid else nullif(r->>'org_id', '')::uuid end;
  insert into public.audit_log (org_id, action, entity, entity_id, details)
  values (v_org, lower(tg_op), tg_table_name, coalesce(r->>'id', r->>'user_id'),
          case when tg_table_name = 'athletes' then jsonb_build_object('display_name', r->>'display_name') else r end);
  return null;
end; $$;
create trigger orgs_audit after insert or update or delete on public.orgs for each row execute function app.audit();
create trigger org_members_audit after insert or update or delete on public.org_members for each row execute function app.audit();
create trigger athletes_audit after insert or delete on public.athletes for each row execute function app.audit();
create trigger consents_audit after insert or update on public.consents for each row execute function app.audit();

-- ---------------------------------------------------------------- RLS
alter table public.platform_admins enable row level security;
alter table public.orgs enable row level security;
alter table public.org_members enable row level security;
alter table public.athletes enable row level security;
alter table public.athlete_profile_history enable row level security;
alter table public.consents enable row level security;
alter table public.audit_log enable row level security;

create policy pa_self on public.platform_admins for select to authenticated using (user_id = (select auth.uid()));

create policy orgs_select on public.orgs for select to authenticated using (app.is_member(id) or app.is_platform_admin());
create policy orgs_update on public.orgs for update to authenticated using (app.has_role(id, array['owner'])) with check (app.has_role(id, array['owner']));
-- Salon oluşturma yalnız create_org() ile (sahip üyeliğiyle birlikte, tek işlemde).

create policy om_select on public.org_members for select to authenticated using (
  user_id = (select auth.uid()) or app.is_staff(org_id) or (app.is_member(org_id) and role in ('owner', 'coach'))
);
create policy om_update on public.org_members for update to authenticated using (app.has_role(org_id, array['owner'])) with check (app.has_role(org_id, array['owner']));
create policy om_delete on public.org_members for delete to authenticated using (
  app.has_role(org_id, array['owner']) or (user_id = (select auth.uid()) and role <> 'owner')
);

create policy ath_select on public.athletes for select to authenticated using (app.is_staff(org_id) or user_id = (select auth.uid()));
create policy ath_insert on public.athletes for insert to authenticated with check (app.is_staff(org_id));
create policy ath_update on public.athletes for update to authenticated using (app.is_staff(org_id) or user_id = (select auth.uid())) with check (app.is_staff(org_id) or user_id = (select auth.uid()));
create policy ath_delete on public.athletes for delete to authenticated using (app.has_role(org_id, array['owner']));

create policy aph_select on public.athlete_profile_history for select to authenticated using (
  app.is_staff(org_id) or exists (select 1 from public.athletes a where a.id = athlete_id and a.user_id = (select auth.uid()))
);

create policy cons_select on public.consents for select to authenticated using (user_id = (select auth.uid()) or (org_id is not null and app.is_staff(org_id)));
create policy cons_insert on public.consents for insert to authenticated with check (user_id = (select auth.uid()) and (org_id is null or app.is_member(org_id)));
create policy cons_update on public.consents for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy audit_select on public.audit_log for select to authenticated using ((org_id is not null and app.has_role(org_id, array['owner'])) or app.is_platform_admin());

-- ---------------------------------------------------------------- işlemler (RPC)
create or replace function public.create_org(p_name text) returns public.orgs
language plpgsql security definer set search_path = '' as $$
declare v public.orgs; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Giriş gerekli'; end if;
  if (select count(*) from public.org_members where user_id = v_uid and role = 'owner') >= 5 then
    raise exception 'En fazla 5 salon oluşturabilirsiniz';
  end if;
  insert into public.orgs (name, created_by) values (btrim(p_name), v_uid) returning * into v;
  insert into public.org_members (org_id, user_id, role) values (v.id, v_uid, 'owner');
  return v;
end; $$;

create or replace function public.join_org(p_code text, p_display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_uid uuid := auth.uid(); v_ath uuid;
begin
  if v_uid is null then raise exception 'Giriş gerekli'; end if;
  select id into v_org from public.orgs where join_code = upper(btrim(p_code)) and plan <> 'askida';
  if v_org is null then raise exception 'Salon kodu geçersiz'; end if;
  insert into public.org_members (org_id, user_id, role) values (v_org, v_uid, 'athlete') on conflict do nothing;
  insert into public.athletes (org_id, user_id, display_name, created_by)
  values (v_org, v_uid, btrim(p_display_name), v_uid)
  on conflict (org_id, user_id) do nothing returning id into v_ath;
  return v_org;
end; $$;

create or replace function public.set_member_role(p_org uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_role(p_org, array['owner']) then raise exception 'Yalnız salon sahibi'; end if;
  if p_role not in ('coach', 'athlete', 'judge') then raise exception 'Geçersiz rol'; end if;
  if p_user = auth.uid() then raise exception 'Kendi rolünüzü değiştiremezsiniz'; end if;
  update public.org_members set role = p_role where org_id = p_org and user_id = p_user and role <> 'owner';
  if not found then raise exception 'Üye bulunamadı'; end if;
end; $$;

create or replace function public.regenerate_join_code(p_org uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
begin
  if not app.has_role(p_org, array['owner']) then raise exception 'Yalnız salon sahibi'; end if;
  update public.orgs set join_code = v where id = p_org;
  return v;
end; $$;

revoke execute on function public.create_org(text), public.join_org(text, text), public.set_member_role(uuid, uuid, text), public.regenerate_join_code(uuid) from public, anon;
grant execute on function public.create_org(text), public.join_org(text, text), public.set_member_role(uuid, uuid, text), public.regenerate_join_code(uuid) to authenticated;

-- Yetkiler: anon hiçbir tabloya erişemez; authenticated RLS'e tabidir.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on public.orgs, public.org_members, public.athletes, public.consents to authenticated;
grant select on public.athlete_profile_history, public.audit_log, public.platform_admins to authenticated;
revoke insert, delete on public.orgs from authenticated;
revoke insert on public.org_members from authenticated;
revoke delete on public.consents from authenticated;
