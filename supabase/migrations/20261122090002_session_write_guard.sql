-- A-2: Yazma izni olmayan salonda oturum yeniden açılamaz.
-- İzinli: live→finished, planned/live→cancelled, finished_at/notes.
-- Yeni session_entries: yalnız org_can_write veya oturum live iken.
-- Canlı segment yazımı kilitlenmez (mevcut seg_* politikaları).

create or replace function app.sessions_write_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if app.org_can_write(old.org_id) then
    return new;
  end if;

  if old.status = 'finished' and new.status is distinct from old.status then
    raise exception 'Süresi geçmiş salonda bitmiş oturum yeniden açılamaz';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'live' and new.status = 'finished')
      or (old.status in ('planned', 'live') and new.status = 'cancelled')
    ) then
      raise exception 'Yazma izni olmayan salonda bu durum değişikliğine izin yok';
    end if;
  end if;

  if new.org_id is distinct from old.org_id
     or new.kind is distinct from old.kind
     or new.title is distinct from old.title
     or new.config_version_id is distinct from old.config_version_id
     or new.track_roxzone is distinct from old.track_roxzone
     or new.scheduled_at is distinct from old.scheduled_at
     or new.started_at is distinct from old.started_at
     or new.created_by is distinct from old.created_by
  then
    raise exception 'Yazma izni olmayan salonda yalnız durum/finished_at/notes güncellenebilir';
  end if;

  return new;
end; $$;

drop trigger if exists sessions_write_guard on public.sessions;
create trigger sessions_write_guard
  before update on public.sessions
  for each row execute function app.sessions_write_guard();

create or replace function app.entries_write_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status text; v_org uuid;
begin
  select s.status, s.org_id into v_status, v_org from public.sessions s where s.id = new.session_id;
  if v_org is null then raise exception 'Oturum bulunamadı'; end if;
  if app.org_can_write(coalesce(new.org_id, v_org)) then
    return new;
  end if;
  if tg_op = 'INSERT' and v_status is distinct from 'live' then
    raise exception 'Yazma izni olmayan salonda yalnız canlı oturuma sporcu eklenebilir';
  end if;
  return new;
end; $$;

drop trigger if exists entries_write_guard on public.session_entries;
create trigger entries_write_guard
  before insert on public.session_entries
  for each row execute function app.entries_write_guard();
