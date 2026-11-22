-- A-1: Askıdaki (ve süresi dolmuş) salon yazamamalı.
-- app.org_can_write: plan <> askida ve deneme/aktif süre kuralları.
-- Kilit: yeni oturum (ses_insert) + join_org. Okuma / CSV / canlı segment kilitlenmez.

alter table public.orgs
  add column if not exists trial_ends_at timestamptz,
  add column if not exists paid_until timestamptz;

create or replace function app.org_can_write(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.orgs o
    where o.id = p_org
      and o.plan <> 'askida'
      and (
        (o.plan = 'deneme' and (o.trial_ends_at is null or o.trial_ends_at > now()))
        or (o.plan = 'aktif' and (o.paid_until is null or o.paid_until > now()))
      )
  );
$$;

grant execute on function app.org_can_write(uuid) to authenticated;

drop policy if exists ses_insert on public.sessions;
create policy ses_insert on public.sessions for insert to authenticated
  with check (app.is_staff(org_id) and app.org_can_write(org_id));

create or replace function public.join_org(p_code text, p_display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_uid uuid := auth.uid(); v_ath uuid;
begin
  if v_uid is null then raise exception 'Giriş gerekli'; end if;
  select id into v_org from public.orgs where join_code = upper(btrim(p_code));
  if v_org is null or not app.org_can_write(v_org) then
    raise exception 'Salon kodu geçersiz';
  end if;
  insert into public.org_members (org_id, user_id, role) values (v_org, v_uid, 'athlete') on conflict do nothing;
  insert into public.athletes (org_id, user_id, display_name, created_by)
  values (v_org, v_uid, btrim(p_display_name), v_uid)
  on conflict (org_id, user_id) do nothing returning id into v_ath;
  return v_org;
end; $$;

revoke execute on function public.join_org(text, text) from public, anon;
grant execute on function public.join_org(text, text) to authenticated;
