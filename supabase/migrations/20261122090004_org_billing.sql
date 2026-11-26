-- A-3: Faturalama notu ayrı tabloda; yalnız platform yöneticisi okur/yazar.
-- orgs / audit_log / RPC üzerinden sızdırılmaz.

create table public.org_billing (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  notes text not null default '' check (char_length(notes) <= 4000),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

create or replace function app.org_billing_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end; $$;

create trigger org_billing_touch
  before insert or update on public.org_billing
  for each row execute function app.org_billing_touch();

-- Yönetici yazımları için ayrı denetim: org_id boş → salon sahibi göremez.
create or replace function app.org_billing_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (org_id, action, entity, entity_id, details)
  values (
    null,
    lower(tg_op),
    'org_billing',
    coalesce(new.org_id, old.org_id)::text,
    jsonb_build_object('org_id', coalesce(new.org_id, old.org_id))
  );
  return coalesce(new, old);
end; $$;

create trigger org_billing_audit
  after insert or update or delete on public.org_billing
  for each row execute function app.org_billing_audit();

alter table public.org_billing enable row level security;

create policy ob_select on public.org_billing for select to authenticated
  using (app.is_platform_admin());
create policy ob_insert on public.org_billing for insert to authenticated
  with check (app.is_platform_admin());
create policy ob_update on public.org_billing for update to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy ob_delete on public.org_billing for delete to authenticated
  using (app.is_platform_admin());

grant select, insert, update, delete on public.org_billing to authenticated;

-- admin_set_plan: notu org_billing'e yazar (orgs/audit_log details'e ham not konmaz).
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
      paid_until = p_paid_until
  where o.id = p_org
  returning * into v;

  if p_note is not null and btrim(p_note) <> '' then
    insert into public.org_billing (org_id, notes)
    values (v.id, btrim(p_note))
    on conflict (org_id) do update
      set notes = excluded.notes;
  end if;

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

revoke execute on function public.admin_set_plan(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.admin_set_plan(uuid, text, timestamptz, text) to authenticated;
