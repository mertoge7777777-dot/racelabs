-- A-4: Platform yönetici işlemleri — admin_list_orgs, admin_set_plan.
-- is_platform_admin, security definer, search_path='', revoke public/anon.
-- plan enum; paid_until max +2y; aktif ise paid_until zorunlu; audit_log.

create or replace function public.admin_list_orgs()
returns table (
  id uuid,
  name text,
  join_code text,
  plan text,
  trial_ends_at timestamptz,
  paid_until timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Yalnız platform yöneticisi';
  end if;
  return query
  select o.id, o.name, o.join_code, o.plan, o.trial_ends_at, o.paid_until, o.created_at, o.updated_at
  from public.orgs o
  order by o.created_at desc;
end; $$;

create or replace function public.admin_set_plan(
  p_org uuid,
  p_plan text,
  p_paid_until timestamptz default null,
  p_note text default null
) returns public.orgs
language plpgsql security definer set search_path = '' as $$
declare v public.orgs;
begin
  if not app.is_platform_admin() then
    raise exception 'Yalnız platform yöneticisi';
  end if;
  if p_plan is null or p_plan not in ('deneme', 'aktif', 'askida') then
    raise exception 'Geçersiz plan';
  end if;
  if p_plan = 'aktif' and p_paid_until is null then
    raise exception 'Aktif plan için paid_until zorunlu';
  end if;
  if p_paid_until is not null and p_paid_until > now() + interval '2 years' then
    raise exception 'paid_until en fazla 2 yıl ileri olabilir';
  end if;
  if not exists (select 1 from public.orgs o where o.id = p_org) then
    raise exception 'Salon bulunamadı';
  end if;

  update public.orgs o
  set plan = p_plan,
      paid_until = case when p_plan = 'aktif' then p_paid_until else p_paid_until end
  where o.id = p_org
  returning * into v;

  -- Faturalama notu A-3 org_billing'e yazılır; burada denetimde not sızdırılmaz.
  insert into public.audit_log (org_id, action, entity, entity_id, details)
  values (
    v.id,
    'admin_set_plan',
    'orgs',
    v.id::text,
    jsonb_build_object(
      'plan', v.plan,
      'paid_until', v.paid_until,
      'has_note', (p_note is not null and btrim(p_note) <> '')
    )
  );

  return v;
end; $$;

revoke execute on function public.admin_list_orgs() from public, anon;
revoke execute on function public.admin_set_plan(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.admin_list_orgs() to authenticated;
grant execute on function public.admin_set_plan(uuid, text, timestamptz, text) to authenticated;
