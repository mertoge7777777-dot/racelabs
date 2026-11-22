-- Yarış Konfigürasyon Motoru: kurallar koda sabit yazılmaz. Yayınlanan sürüm DEĞİŞTİRİLEMEZ;
-- sonuçlar ileride config_version_id ile bu sürüme bağlanır, böylece eski sonuçlar kendi kurallarıyla kalır.

create table public.race_configs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs(id) on delete cascade, -- null = platform geneli (herkes görür)
  code text not null check (code ~ '^[a-z0-9][a-z0-9_-]{1,40}$'),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  season text check (char_length(season) <= 20),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index race_configs_code_uidx on public.race_configs (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

create table public.race_config_versions (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references public.race_configs(id) on delete cascade,
  version int not null check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'published')),
  payload jsonb not null,
  source_url text check (char_length(source_url) <= 500),
  verified boolean not null default false,
  verified_note text check (char_length(verified_note) <= 1000),
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (config_id, version)
);

-- Biçim kontrolü: 1+ koşu, 1–12 istasyon, her istasyonun ölçütü ve hedefi; bölümler kodlu.
create or replace function app.race_payload_errors(p jsonb) returns text[]
language plpgsql immutable set search_path = '' as $$
declare e text[] := '{}'; s jsonb; d jsonb; n int;
begin
  if jsonb_typeof(p) <> 'object' then return array['payload nesne olmalı']; end if;
  if coalesce((p->'runs'->>'count')::int, 0) < 0 or coalesce((p->'runs'->>'count')::int, 0) > 20 then e := array_append(e, ('koşu sayısı 0–20 olmalı')::text); end if;
  if jsonb_typeof(p->'stations') <> 'array' then return array_append(e, 'stations dizi olmalı'::text); end if;
  n := jsonb_array_length(p->'stations');
  if n < 1 or n > 12 then e := array_append(e, ('istasyon sayısı 1–12 olmalı')::text); end if;
  for s in select * from jsonb_array_elements(p->'stations') loop
    if coalesce(s->>'code', '') !~ '^[a-z0-9_]{2,30}$' then e := array_append(e, (('geçersiz istasyon kodu: ' || coalesce(s->>'code', '?')))::text); end if;
    if coalesce(s->>'metric', '') not in ('distance_m', 'reps', 'calories', 'time_s') then e := array_append(e, (('geçersiz ölçüt: ' || coalesce(s->>'code', '?')))::text); end if;
    if coalesce((s->>'target')::numeric, 0) <= 0 then e := array_append(e, (('hedef > 0 olmalı: ' || coalesce(s->>'code', '?')))::text); end if;
  end loop;
  if jsonb_typeof(p->'divisions') <> 'array' or jsonb_array_length(p->'divisions') < 1 then e := array_append(e, ('en az 1 bölüm gerekli')::text); end if;
  for d in select * from jsonb_array_elements(coalesce(p->'divisions', '[]')) loop
    if coalesce(d->>'code', '') !~ '^[a-z0-9_]{2,40}$' then e := array_append(e, (('geçersiz bölüm kodu: ' || coalesce(d->>'code', '?')))::text); end if;
  end loop;
  return e;
end; $$;

create or replace function app.can_manage_config(p_config uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.race_configs c where c.id = p_config
      and ((c.org_id is null and app.is_platform_admin()) or (c.org_id is not null and app.has_role(c.org_id, array['owner'])))
  );
$$;
create or replace function app.can_see_config(p_config uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.race_configs c where c.id = p_config and (c.org_id is null or app.is_member(c.org_id) or app.is_platform_admin()));
$$;
grant execute on function app.can_manage_config(uuid), app.can_see_config(uuid), app.race_payload_errors(jsonb) to authenticated;

create or replace function app.rcv_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'published' then
    raise exception 'Yayınlanmış yarış formatı sürümü değiştirilemez/silinemez (yeni sürüm oluşturun)';
  end if;
  if tg_op = 'INSERT' and new.status = 'published' then
    raise exception 'Sürüm taslak olarak oluşturulur; publish_race_config_version() ile yayınlanır';
  end if;
  if tg_op = 'UPDATE' and new.status = 'published' and current_setting('app.publishing', true) is distinct from 'on' then
    raise exception 'Yayınlama yalnız publish_race_config_version() ile';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end; $$;
create trigger rcv_guard before insert or update or delete on public.race_config_versions for each row execute function app.rcv_guard();

create trigger race_configs_audit after insert or update or delete on public.race_configs for each row execute function app.audit();
create trigger rcv_audit after insert or update on public.race_config_versions for each row execute function app.audit();

alter table public.race_configs enable row level security;
alter table public.race_config_versions enable row level security;

create policy rc_select on public.race_configs for select to authenticated using (org_id is null or app.is_member(org_id) or app.is_platform_admin());
create policy rc_insert on public.race_configs for insert to authenticated with check ((org_id is null and app.is_platform_admin()) or (org_id is not null and app.has_role(org_id, array['owner'])));
create policy rc_update on public.race_configs for update to authenticated using (app.can_manage_config(id)) with check (app.can_manage_config(id));

create policy rcv_select on public.race_config_versions for select to authenticated using (
  app.can_see_config(config_id) and (status = 'published' or app.can_manage_config(config_id))
);
create policy rcv_insert on public.race_config_versions for insert to authenticated with check (app.can_manage_config(config_id));
create policy rcv_update on public.race_config_versions for update to authenticated using (app.can_manage_config(config_id)) with check (app.can_manage_config(config_id));
create policy rcv_delete on public.race_config_versions for delete to authenticated using (app.can_manage_config(config_id));

grant select, insert, update on public.race_configs to authenticated;
grant select, insert, update, delete on public.race_config_versions to authenticated;

create or replace function public.new_race_config_version(p_config uuid) returns public.race_config_versions
language plpgsql security definer set search_path = '' as $$
declare v public.race_config_versions; src public.race_config_versions;
begin
  if not app.can_manage_config(p_config) then raise exception 'Yetki yok'; end if;
  if exists (select 1 from public.race_config_versions where config_id = p_config and status = 'draft') then
    raise exception 'Bu formatın zaten bir taslağı var';
  end if;
  select * into src from public.race_config_versions where config_id = p_config order by version desc limit 1;
  if src.id is null then raise exception 'Kopyalanacak sürüm yok'; end if;
  insert into public.race_config_versions (config_id, version, payload, source_url)
  values (p_config, src.version + 1, src.payload, src.source_url) returning * into v;
  return v;
end; $$;

create or replace function public.publish_race_config_version(p_version uuid, p_verified_note text default null) returns public.race_config_versions
language plpgsql security definer set search_path = '' as $$
declare v public.race_config_versions; errs text[];
begin
  select * into v from public.race_config_versions where id = p_version;
  if v.id is null then raise exception 'Sürüm bulunamadı'; end if;
  if not app.can_manage_config(v.config_id) then raise exception 'Yetki yok'; end if;
  if v.status = 'published' then raise exception 'Zaten yayınlanmış'; end if;
  errs := app.race_payload_errors(v.payload);
  if array_length(errs, 1) > 0 then raise exception 'Format hatalı: %', array_to_string(errs, '; '); end if;
  perform set_config('app.publishing', 'on', true);
  update public.race_config_versions
     set status = 'published', published_at = now(), published_by = auth.uid(),
         verified = (p_verified_note is not null and btrim(p_verified_note) <> ''), verified_note = nullif(btrim(p_verified_note), '')
   where id = p_version returning * into v;
  perform set_config('app.publishing', 'off', true);
  return v;
end; $$;

-- Salon sahibi platform formatını kendi salonuna kopyalayıp uyarlayabilir (ör. kısa salon simülasyonu).
create or replace function public.copy_race_config_to_org(p_version uuid, p_org uuid, p_code text, p_name text) returns public.race_configs
language plpgsql security definer set search_path = '' as $$
declare src public.race_config_versions; c public.race_configs;
begin
  if not app.has_role(p_org, array['owner']) then raise exception 'Yalnız salon sahibi'; end if;
  select * into src from public.race_config_versions where id = p_version;
  if src.id is null or not app.can_see_config(src.config_id) then raise exception 'Kaynak bulunamadı'; end if;
  insert into public.race_configs (org_id, code, name, season) values (p_org, p_code, p_name, (select season from public.race_configs where id = src.config_id)) returning * into c;
  insert into public.race_config_versions (config_id, version, payload, source_url) values (c.id, 1, src.payload, src.source_url);
  return c;
end; $$;

revoke execute on function public.new_race_config_version(uuid), public.publish_race_config_version(uuid, text), public.copy_race_config_to_org(uuid, uuid, text, text) from public, anon;
grant execute on function public.new_race_config_version(uuid), public.publish_race_config_version(uuid, text), public.copy_race_config_to_org(uuid, uuid, text, text) to authenticated;

-- Tohum: HYROX biçiminde platform formatı, TASLAK. Mesafe/tekrarlar yaygın bilinen değerlerdir;
-- bölüm ağırlıkları BOŞ bırakıldı: resmî 2026/27 kural kitabından girilip doğrulama notuyla yayınlanmalı.
with c as (
  insert into public.race_configs (org_id, code, name, season, created_by)
  values (null, 'hybrid-standart', 'Hibrit yarış — standart format (8 × 1 km + 8 istasyon)', '2026/27', null)
  returning id
)
insert into public.race_config_versions (config_id, version, payload, source_url, created_by)
select c.id, 1, $json${
  "format": "hybrid_standard",
  "runs": {"count": 8, "distance_m": 1000, "pattern": "kosu_sonra_istasyon"},
  "roxzone": {"olcum": "istasyon girisi-cikisi arasi gecis suresi ayri kaydedilir"},
  "stations": [
    {"order": 1, "code": "skierg", "name_tr": "SkiErg", "metric": "distance_m", "target": 1000},
    {"order": 2, "code": "sled_push", "name_tr": "Kızak itme", "metric": "distance_m", "target": 50, "load_key": "sled_push_kg"},
    {"order": 3, "code": "sled_pull", "name_tr": "Kızak çekme", "metric": "distance_m", "target": 50, "load_key": "sled_pull_kg"},
    {"order": 4, "code": "burpee_broad_jump", "name_tr": "Burpee uzun atlama", "metric": "distance_m", "target": 80},
    {"order": 5, "code": "rowing", "name_tr": "Kürek", "metric": "distance_m", "target": 1000},
    {"order": 6, "code": "farmers_carry", "name_tr": "Çiftçi taşıma", "metric": "distance_m", "target": 200, "load_key": "farmers_kg_each"},
    {"order": 7, "code": "sandbag_lunges", "name_tr": "Kum torbalı lunge", "metric": "distance_m", "target": 100, "load_key": "sandbag_kg"},
    {"order": 8, "code": "wall_balls", "name_tr": "Wall ball", "metric": "reps", "target": 100, "load_key": "wall_ball_kg", "extra_key": "wall_ball_target_m"}
  ],
  "divisions": [
    {"code": "open_women", "label": "Open Kadın", "type": "single", "loads": {}},
    {"code": "open_men", "label": "Open Erkek", "type": "single", "loads": {}},
    {"code": "pro_women", "label": "Pro Kadın", "type": "single", "loads": {}},
    {"code": "pro_men", "label": "Pro Erkek", "type": "single", "loads": {}},
    {"code": "doubles_women", "label": "Doubles Kadın", "type": "doubles", "loads": {}},
    {"code": "doubles_men", "label": "Doubles Erkek", "type": "doubles", "loads": {}},
    {"code": "doubles_mixed", "label": "Doubles Karma", "type": "doubles", "loads": {}},
    {"code": "relay", "label": "Relay (4 kişi)", "type": "relay", "loads": {}}
  ],
  "rules_note": "Yükler ve 2026/27 kural değişiklikleri resmi kural kitabindan girilecek; dogrulanmadan yayinlanmamali."
}$json$::jsonb, null, null
from c;
