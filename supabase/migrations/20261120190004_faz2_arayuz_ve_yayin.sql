-- Arayüz için: kullanıcı bu formatı düzenleyebilir mi? (yalnız evet/hayır döner, veri sızdırmaz)
create or replace function public.can_manage_config_ui(p_config uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select app.can_manage_config(p_config); $$;
revoke execute on function public.can_manage_config_ui(uuid) from public, anon;
grant execute on function public.can_manage_config_ui(uuid) to authenticated;

-- Platform formatı v1: yalnız koşu/istasyon sırası ve mesafe/tekrar hedefleri ile, YÜKLER BOŞ olarak
-- "doğrulanmadı" etiketiyle yayınlanır (kronometre ve tahmin için yeterli). Yükler resmî kural kitabından
-- doğrulanınca v2 olarak yayınlanmalı.
update public.race_config_versions v
   set payload = jsonb_set(v.payload, '{rules_note}', to_jsonb('v1: istasyon sırası ve mesafe/tekrar hedefleri yaygın standart değerlerdir; kategori yükleri boştur. Resmî 2026/27 kural kitabıyla doğrulanıp yüklerle v2 yayınlanmalıdır.'::text))
  from public.race_configs c
 where c.id = v.config_id and c.org_id is null and c.code = 'hybrid-standart' and v.version = 1 and v.status = 'draft';

do $$
declare v_id uuid;
begin
  select v.id into v_id from public.race_config_versions v join public.race_configs c on c.id = v.config_id
   where c.org_id is null and c.code = 'hybrid-standart' and v.version = 1 and v.status = 'draft';
  if v_id is not null then
    perform set_config('app.publishing', 'on', true);
    update public.race_config_versions set status = 'published', published_at = now(), verified = false where id = v_id;
    perform set_config('app.publishing', 'off', true);
  end if;
end $$;
