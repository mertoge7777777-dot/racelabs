-- Kodla katılan kişi önce "sporcu" olur; sahip onu antrenör/hakem yapınca sporcu kaydı sporcu listesinde kalıyordu.
-- Düzeltme: rol antrenör/hakem olunca, HİÇ sonucu olmayan sporcu kaydı kaldırılır (sonucu varsa geçmiş korunur).
-- Rol tekrar sporcu yapılırsa kayıt yeniden oluşturulur.
create or replace function public.set_member_role(p_org uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_role(p_org, array['owner']) then raise exception 'Yalnız salon sahibi'; end if;
  if p_role not in ('coach', 'athlete', 'judge') then raise exception 'Geçersiz rol'; end if;
  if p_user = auth.uid() then raise exception 'Kendi rolünüzü değiştiremezsiniz'; end if;
  update public.org_members set role = p_role where org_id = p_org and user_id = p_user and role <> 'owner';
  if not found then raise exception 'Üye bulunamadı'; end if;
  if p_role in ('coach', 'judge') then
    delete from public.athletes a
     where a.org_id = p_org and a.user_id = p_user
       and not exists (select 1 from public.session_entries e where e.athlete_id = a.id);
  elsif not exists (select 1 from public.athletes where org_id = p_org and user_id = p_user) then
    insert into public.athletes (org_id, user_id, display_name, created_by)
    select p_org, p_user, coalesce(nullif(split_part(u.email, '@', 1), ''), 'Sporcu'), auth.uid() from auth.users u where u.id = p_user;
  end if;
end; $$;
