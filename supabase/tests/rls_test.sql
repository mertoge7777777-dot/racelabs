-- RaceLab RLS ve iş kuralı testleri. Tek işlemde çalışır ve SONUNDA GERİ ALINIR (veri bırakmaz).
-- Çıktı: her test için GECTI/KALDI satırı. Supabase'de ve yerel Postgres'te aynı şekilde çalışır.
begin;
create temp table t_result (n serial, name text, ok boolean, detail text) on commit drop;
grant all on t_result to authenticated, anon;
grant usage on sequence t_result_n_seq to authenticated, anon;

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.as_admin() returns void language plpgsql as $$
begin perform set_config('role', 'postgres', true); perform set_config('request.jwt.claims', '', true); end $$;
create or replace function pg_temp.ok(name text, cond boolean, detail text default null) returns void language plpgsql as $$
begin insert into t_result(name, ok, detail) values (name, coalesce(cond, false), detail); end $$;
create or replace function pg_temp.fails(name text, sql text) returns void language plpgsql as $$
begin
  begin execute sql; insert into t_result(name, ok, detail) values (name, false, 'HATA VERMESİ GEREKİRDİ');
  exception when others then insert into t_result(name, ok, detail) values (name, true, sqlerrm); end;
end $$;

do $$
declare
  ua uuid := 'a0000000-0000-4000-8000-00000000000a'; -- salon 1 sahibi
  ub uuid := 'a0000000-0000-4000-8000-00000000000b'; -- salon 1 antrenör
  uc uuid := 'a0000000-0000-4000-8000-00000000000c'; -- salon 1 sporcu
  uc2 uuid := 'a0000000-0000-4000-8000-0000000000c2'; -- salon 1 sporcu 2 (paylaşmıyor)
  ud uuid := 'a0000000-0000-4000-8000-00000000000d'; -- salon 2 sahibi
  ue uuid := 'a0000000-0000-4000-8000-00000000000e'; -- salon 2 sporcu
  uj uuid := 'a0000000-0000-4000-8000-0000000000aa'; -- salon 1 hakem
  up uuid := 'a0000000-0000-4000-8000-0000000000ff'; -- platform yöneticisi
  o1 uuid; o2 uuid; code1 text; code2 text; bad uuid; ac uuid; ac2 uuid; ae uuid; cfg uuid; ver uuid; ver2 uuid; s1 uuid; en1 uuid; en2 uuid;
  n int; j jsonb; t text;
begin
  insert into auth.users (id, email) values (ua,'a@t.rl'),(ub,'b@t.rl'),(uc,'c@t.rl'),(uc2,'c2@t.rl'),(ud,'d@t.rl'),(ue,'e@t.rl'),(uj,'j@t.rl'),(up,'p@t.rl');
  insert into public.platform_admins (user_id) values (up);

  -- Salon kurulumu
  perform pg_temp.as_user(ua); select id, join_code into o1, code1 from public.create_org('Salon Bir');
  perform pg_temp.as_user(ud); select id, join_code into o2, code2 from public.create_org('Salon İki');
  perform pg_temp.ok('Salon oluşturulunca kurucu sahip olur', exists(select 1 from public.org_members where org_id = o2 and user_id = ud and role = 'owner'));
  perform pg_temp.as_user(uc); perform public.join_org(code1, 'Ceren Sporcu');
  perform pg_temp.as_user(uc2); perform public.join_org(code1, 'Cem Gizli');
  perform pg_temp.as_user(ub); perform public.join_org(code1, 'Bora Antrenör');
  perform pg_temp.as_user(uj); perform public.join_org(code1, 'Hakan Hakem');
  perform pg_temp.as_user(ua); perform public.set_member_role(o1, ub, 'coach'); perform public.set_member_role(o1, uj, 'judge');
  perform pg_temp.ok('Rol değişince sporcu verisi silinmez (gizlenir)', (select count(*) from public.athletes where org_id = o1 and user_id in (ub, uj)) = 2);
  perform pg_temp.as_user(ue); perform public.join_org(code2, 'Eda Sporcu');
  perform pg_temp.as_admin();
  select id into ac from public.athletes where user_id = uc; select id into ac2 from public.athletes where user_id = uc2; select id into ae from public.athletes where user_id = ue;
  update public.athletes set share_results = false where id = ac2;
  perform pg_temp.as_user(ue); perform pg_temp.fails('Geçersiz salon kodu reddedilir', 'select public.join_org(''XXXXXXXX'', ''Eda'')');

  -- Salon yalıtımı
  perform pg_temp.as_user(ud);
  perform pg_temp.ok('Salon 2 sahibi salon 1''i göremez', (select count(*) from public.orgs where id = o1) = 0);
  perform pg_temp.ok('Salon 2 sahibi salon 1 sporcularını göremez', (select count(*) from public.athletes where org_id = o1) = 0);
  perform pg_temp.ok('Salon 2 sahibi salon 1 üyeliklerini göremez', (select count(*) from public.org_members where org_id = o1) = 0);
  update public.athletes set goals = 'sızma' where id = ac; get diagnostics n = row_count;
  perform pg_temp.ok('Salon 2 sahibi salon 1 sporcusunu değiştiremez', n = 0);
  perform pg_temp.fails('Salon 2 sahibi salon 1''e sporcu ekleyemez', format('insert into public.athletes (org_id, display_name) values (%L, ''Sahte'')', o1));
  perform pg_temp.fails('Başkasının salonunda rol değiştirilemez', format('select public.set_member_role(%L, %L, ''coach'')', o1, uc));

  -- Rol kuralları
  perform pg_temp.as_user(ub);
  perform pg_temp.ok('Antrenör kendi salonunun sporcularını görür', (select count(*) from public.athletes where org_id = o1) = 4);
  perform pg_temp.fails('Antrenör rol değiştiremez', format('select public.set_member_role(%L, %L, ''coach'')', o1, uc));
  perform pg_temp.as_user(uc);
  perform pg_temp.ok('Sporcu yalnız kendi profilini görür', (select count(*) from public.athletes) = 1);
  perform pg_temp.ok('Sporcu antrenör notunu OKUYAMAZ', (select count(*) from public.athlete_coach_notes) = 0);
  perform pg_temp.fails('Sporcu antrenör notu yazamaz', format('insert into public.athlete_coach_notes (athlete_id, org_id, notes) values (%L, %L, ''x'')', ac, o1));
  perform pg_temp.fails('Sporcu kaydını başka hesaba bağlayamaz', format('update public.athletes set user_id = %L where id = %L', ue, ac));
  perform pg_temp.fails('KVKK onayının tarihi değiştirilemez', 'update public.consents set granted_at = now() - interval ''1 year''');
  perform pg_temp.fails('KVKK onayının türü değiştirilemez', 'update public.consents set kind = ''veli_onayi''');
  update public.athletes set weight_kg = 61.5, goals = 'Sub 1:30' where id = ac; get diagnostics n = row_count;
  perform pg_temp.ok('Sporcu kendi profil bilgisini güncelleyebilir', n = 1);
  perform pg_temp.ok('Profil değişikliği geçmişe yazılır (üzerine yazılmaz)', (select count(*) from public.athlete_profile_history where athlete_id = ac) = 1);
  perform pg_temp.ok('Sporcu denetim kaydını göremez', (select count(*) from public.audit_log) = 0);
  perform pg_temp.fails('Sporcu salon oluşturmayı doğrudan tabloya yazarak yapamaz', 'insert into public.orgs (name) values (''Korsan'')');
  perform pg_temp.as_user(ua);
  perform pg_temp.ok('Sahip denetim kaydını görür', (select count(*) from public.audit_log where org_id = o1) > 0);
  perform pg_temp.fails('Sahip salon planını kendisi değiştiremez', format('update public.orgs set plan = ''aktif'' where id = %L', o1));
  update public.orgs set name = 'Salon Bir Yeni' where id = o1; get diagnostics n = row_count;
  perform pg_temp.ok('Sahip salon adını değiştirebilir', n = 1);
  perform pg_temp.fails('Sahip üyelik satırını doğrudan değiştiremez (rol yalnız RPC ile)', format('update public.org_members set role = ''owner'' where org_id = %L and user_id = %L', o1, ub));
  insert into public.athlete_coach_notes (athlete_id, notes) values (ac, 'Diz hassas');
  perform pg_temp.ok('Antrenör notu ayrı tabloda kaydedilir', (select notes from public.athlete_coach_notes where athlete_id = ac) = 'Diz hassas');
  perform pg_temp.ok('Antrenör notu sporcunun değişiklik geçmişine girmez', not exists (select 1 from public.athlete_profile_history where new_values ? 'coach_notes'));
  perform pg_temp.fails('Personel yeni sporcuyu bir hesaba bağlayamaz', format('insert into public.athletes (org_id, user_id, display_name) values (%L, %L, ''Bağlı'')', o1, ue));

  -- Anonim erişim
  perform set_config('role', 'anon', true); perform set_config('request.jwt.claims', '', true);
  perform pg_temp.fails('Anonim kullanıcı sporcu tablosunu okuyamaz', 'select count(*) from public.athletes');

  -- Yarış formatı motoru (v1 platformda yayında, doğrulanmamış; v2 taslak açılıp doğrulanarak yayınlanır)
  perform pg_temp.as_admin(); select id into cfg from public.race_configs where code = 'hybrid-standart' and org_id is null;
  select id into ver from public.race_config_versions where config_id = cfg and version = 1;
  perform pg_temp.ok('Platform v1 yayında ve "doğrulanmadı" olarak işaretli', (select status = 'published' and not verified from public.race_config_versions where id = ver));
  perform pg_temp.as_user(ua);
  perform pg_temp.fails('Salon sahibi platform formatına yeni sürüm açamaz', format('select public.new_race_config_version(%L)', cfg));
  perform pg_temp.as_user(up);
  select (public.new_race_config_version(cfg)).id into ver2;
  perform pg_temp.ok('Platform yöneticisi yeni sürümü taslak açar (v2)', (select version = 2 and status = 'draft' from public.race_config_versions where id = ver2));
  perform pg_temp.as_user(uc);
  perform pg_temp.ok('Taslak sürüm sporcuya görünmez', (select count(*) from public.race_config_versions where id = ver2) = 0);
  perform pg_temp.fails('Sporcu taslağı yayınlayamaz', format('select public.publish_race_config_version(%L)', ver2));
  perform pg_temp.as_user(up);
  insert into public.race_configs (org_id, code, name) values (null, 'bozuk-test', 'Bozuk') returning id into bad;
  insert into public.race_config_versions (config_id, version, payload) values (bad, 1, '{"runs":{"count":8},"stations":[],"divisions":[]}');
  perform pg_temp.fails('Hatalı format yayınlanamaz', format('select public.publish_race_config_version(%L)', (select id from public.race_config_versions where config_id = bad)));
  update public.race_config_versions set payload = jsonb_set(payload, '{divisions,1,loads}', '{"sled_push_kg":152}') where id = ver2;
  perform public.publish_race_config_version(ver2, 'Test: resmi kural kitabi ile karsilastirildi');
  perform pg_temp.ok('Doğrulama notuyla yayınlanan sürüm "doğrulandı" olur', (select status = 'published' and verified from public.race_config_versions where id = ver2));
  perform pg_temp.fails('Yayınlanmış sürüm değiştirilemez', format('update public.race_config_versions set payload = ''{}'' where id = %L', ver));
  perform pg_temp.fails('Yayınlanmış sürüm silinemez', format('delete from public.race_config_versions where id = %L', ver));
  perform pg_temp.ok('Eski sürüm (v1) aynen korunur', (select payload->'divisions'->1->'loads' = '{}'::jsonb from public.race_config_versions where id = ver));
  perform pg_temp.as_user(uc);
  perform pg_temp.ok('Yayınlanan sürüm herkese görünür', (select count(*) from public.race_config_versions where id = ver2) = 1);
  perform pg_temp.as_user(ua);
  perform public.copy_race_config_to_org(ver, o1, 'salon-kisa', 'Salon kısa simülasyon');
  perform pg_temp.as_user(ud);
  perform pg_temp.as_user(ua);
  perform pg_temp.fails('Salon formatı platform formatına çevrilemez', 'update public.race_configs set org_id = null where code = ''salon-kisa''');
  perform pg_temp.as_user(ud);
  perform pg_temp.ok('Salon 1''in özel formatı salon 2''ye görünmez', (select count(*) from public.race_configs where code = 'salon-kisa') = 0);

  -- Simülasyon günü
  perform pg_temp.as_user(ub);
  insert into public.sessions (org_id, kind, title, config_version_id, status) values (o1, 'simulation', 'Cumartesi simülasyon', ver, 'live') returning id into s1;
  insert into public.session_entries (session_id, org_id, athlete_id, division_code, bib) values (s1, o1, ac, 'open_women', 7) returning id into en1;
  insert into public.session_entries (session_id, org_id, athlete_id, division_code, bib) values (s1, o1, ac2, 'open_men', 8) returning id into en2;
  perform pg_temp.fails('Başka salonun sporcusu oturuma eklenemez', format('insert into public.session_entries (session_id, org_id, athlete_id) values (%L, %L, %L)', s1, o1, ae));
  perform pg_temp.as_user(uj);
  insert into public.segments (id, entry_id, org_id, segment_index, kind, ref_code, duration_ms) values
    ('b0000000-0000-4000-8000-000000000001', en1, o2, 1, 'run', 'run_1', 300000),
    ('b0000000-0000-4000-8000-000000000002', en1, o1, 2, 'roxzone', 'roxzone_1', 30000),
    ('b0000000-0000-4000-8000-000000000003', en1, o1, 3, 'station', 'skierg', 270000),
    ('b0000000-0000-4000-8000-000000000004', en2, o1, 1, 'run', 'run_1', 280000);
  perform pg_temp.ok('Hakem ara süre kaydeder', (select count(*) from public.segments where entry_id in (en1, en2)) = 4);
  perform pg_temp.ok('Yanlış salon kimliği yazılsa da doğru salona bağlanır', (select org_id from public.segments where id = 'b0000000-0000-4000-8000-000000000001') = o1);
  insert into public.segments (id, entry_id, org_id, segment_index, kind, ref_code, duration_ms)
  values ('b0000000-0000-4000-8000-000000000001', en1, o1, 1, 'run', 'run_1', 300000) on conflict (id) do nothing;
  perform pg_temp.ok('Aynı ara süre tekrar gönderilirse çift kayıt olmaz', (select count(*) from public.segments where entry_id = en1) = 3);
  perform pg_temp.as_user(uc);
  perform pg_temp.fails('Sporcu ara süre yazamaz', format('insert into public.segments (id, entry_id, org_id, segment_index, kind, ref_code, duration_ms) values (gen_random_uuid(), %L, %L, 9, ''run'', ''run_2'', 1000)', en1, o1));
  select count(*) into n from public.session_leaderboard(s1);
  perform pg_temp.ok('Sporcu kendi salonunun canlı sıralamasını görür', n = 2);
  select name into t from public.session_leaderboard(s1) where bib = 8;
  perform pg_temp.ok('Sonuç paylaşmayan sporcunun adı gizlenir', t = 'Sporcu #8', t);
  perform pg_temp.ok('Sporcu ham ara sürelerde yalnız kendini görür', (select count(distinct entry_id) from public.segments) = 1);
  perform pg_temp.as_user(ue);
  perform pg_temp.fails('Başka salonun sporcusu sıralamayı göremez', format('select * from public.session_leaderboard(%L)', s1));
  perform pg_temp.fails('Başka salonun sporcusu tahmin alamaz', format('select public.predict_race(%L, %L)', ac, ver));
  perform pg_temp.as_user(uc);
  j := public.predict_race(ac, ver, true);
  perform pg_temp.ok('Eksik veri varsa toplam tahmin VERİLMEZ, eksikler listelenir', (j->>'complete')::boolean = false and j->'realistic_ms' = 'null'::jsonb and jsonb_array_length(j->'missing') > 0, (j->>'segments_used') || '/' || (j->>'segments_total'));
  perform pg_temp.as_admin();
  insert into public.segments (id, entry_id, org_id, segment_index, kind, ref_code, duration_ms)
  select gen_random_uuid(), en1, o1, 10 + g, case when g <= 8 then 'run' when g <= 16 then 'roxzone' else 'station' end,
         case when g <= 8 then 'run_' || g when g <= 16 then 'roxzone_' || (g - 8) else (array['skierg','sled_push','sled_pull','burpee_broad_jump','rowing','farmers_carry','sandbag_lunges','wall_balls'])[g - 16] end,
         240000 + g * 1000
  from generate_series(1, 24) g;
  perform pg_temp.as_user(uc);
  j := public.predict_race(ac, ver, true);
  perform pg_temp.ok('Tüm bölümler varsa üç senaryo üretilir (iyimser ≤ gerçekçi ≤ kötümser)',
     (j->>'complete')::boolean and (j->>'optimistic_ms')::bigint <= (j->>'realistic_ms')::bigint and (j->>'realistic_ms')::bigint <= (j->>'pessimistic_ms')::bigint,
     (j->>'optimistic_ms') || ' / ' || (j->>'realistic_ms') || ' / ' || (j->>'pessimistic_ms') || ' güven=' || (j->>'confidence'));
  perform pg_temp.ok('Tek ölçümle güven "düşük" gösterilir', j->>'confidence' = 'dusuk');
  perform pg_temp.ok('İstasyon geçmişi sporcuya açık', (select count(*) from public.athlete_segment_stats(ac)) >= 24);
  perform pg_temp.as_user(ud);
  perform pg_temp.fails('Başka salon istasyon geçmişini göremez', format('select * from public.athlete_segment_stats(%L)', ac));

  -- A-1: Askıdaki salon yazamamalı (yeni oturum + join_org); okuma sürmeli
  perform pg_temp.as_admin();
  insert into auth.users (id, email) values ('a0000000-0000-4000-8000-0000000000f1', 'f1@t.rl');
  update public.orgs set plan = 'askida' where id = o1;
  perform pg_temp.ok('A-1 org_can_write askıda false', not app.org_can_write(o1));
  perform pg_temp.as_user(ub);
  perform pg_temp.fails('A-1 askıdaki salonda yeni oturum açılamaz',
    format('insert into public.sessions (org_id, kind, title, config_version_id, status) values (%L, ''simulation'', ''Askı deneme'', %L, ''planned'')', o1, ver));
  perform pg_temp.as_user('a0000000-0000-4000-8000-0000000000f1');
  perform pg_temp.fails('A-1 askıdaki salona join_org reddeder', format('select public.join_org(%L, ''Askı Aday'')', code1));
  perform pg_temp.as_user(uc);
  perform pg_temp.ok('A-1 askıdaki salonda oturum okuma sürer', (select count(*) from public.sessions where id = s1) = 1);
  perform pg_temp.ok('A-1 askıdaki salonda canlı sıralama (CSV/okuma) sürer', (select count(*) from public.session_leaderboard(s1)) = 2);
  perform pg_temp.as_admin();
  update public.orgs set plan = 'deneme' where id = o1;
  perform pg_temp.ok('A-1 deneme planında org_can_write true', app.org_can_write(o1));

  -- A-2: Yazma izni yokken oturum geri açılmamalı; canlıya segment/entry mümkün
  perform pg_temp.as_user(ub);
  insert into public.sessions (org_id, kind, title, config_version_id, status)
  values (o1, 'simulation', 'Planlı oturum', ver, 'planned') returning id into bad;
  update public.sessions set status = 'finished', finished_at = now() where id = s1;
  perform pg_temp.as_admin();
  update public.orgs set plan = 'askida' where id = o1;
  perform pg_temp.as_user(ub);
  perform pg_temp.fails('A-2 askıda bitmiş oturum planned yapılamaz',
    format('update public.sessions set status = ''planned'' where id = %L', s1));
  perform pg_temp.fails('A-2 askıda bitmiş oturum live yapılamaz',
    format('update public.sessions set status = ''live'' where id = %L', s1));
  perform pg_temp.fails('A-2 askıda planned oturuma sporcu eklenemez',
    format('insert into public.session_entries (session_id, org_id, athlete_id, division_code, bib) values (%L, %L, %L, ''open_women'', 99)', bad, o1, ac));
  -- Canlı oturum: finished'ı geri live yapıp segment/entry senaryosu için ayrı canlı oturum
  perform pg_temp.as_admin();
  update public.orgs set plan = 'deneme' where id = o1;
  perform pg_temp.as_user(ub);
  insert into public.sessions (org_id, kind, title, config_version_id, status)
  values (o1, 'simulation', 'Canlı kilit testi', ver, 'live') returning id into ver2;
  perform pg_temp.as_admin();
  update public.orgs set plan = 'askida' where id = o1;
  perform pg_temp.as_user(ub);
  insert into public.session_entries (session_id, org_id, athlete_id, division_code, bib)
  values (ver2, o1, ac, 'open_women', 11) returning id into en1;
  perform pg_temp.ok('A-2 askıda canlı oturuma sporcu eklenebilir', en1 is not null);
  insert into public.segments (id, entry_id, org_id, segment_index, kind, ref_code, duration_ms)
  values ('b0000000-0000-4000-8000-0000000000a2', en1, o1, 1, 'run', 'run_1', 111000);
  perform pg_temp.ok('A-2 askıda canlı oturuma segment eklenebilir',
    (select count(*) from public.segments where id = 'b0000000-0000-4000-8000-0000000000a2') = 1);
  update public.sessions set status = 'finished', finished_at = now(), notes = 'tamam' where id = ver2;
  perform pg_temp.ok('A-2 askıda live→finished ve notes güncellenir',
    (select status = 'finished' and notes = 'tamam' from public.sessions where id = ver2));
  update public.sessions set status = 'cancelled' where id = bad;
  perform pg_temp.ok('A-2 askıda planned→cancelled izinli',
    (select status from public.sessions where id = bad) = 'cancelled');
  perform pg_temp.as_admin();
  update public.orgs set plan = 'deneme' where id = o1;

  -- A-4: Platform yönetici RPC koruması
  perform pg_temp.as_user(ua);
  perform pg_temp.fails('A-4 sahip admin_list_orgs çağırmaz', 'select * from public.admin_list_orgs()');
  perform pg_temp.fails('A-4 sahip admin_set_plan çağırmaz',
    format('select public.admin_set_plan(%L, ''aktif'', now() + interval ''30 days'', ''not'')', o1));
  perform set_config('role', 'anon', true); perform set_config('request.jwt.claims', '', true);
  perform pg_temp.fails('A-4 anon admin_list_orgs çağırmaz', 'select * from public.admin_list_orgs()');
  perform pg_temp.fails('A-4 anon admin_set_plan çağırmaz',
    format('select public.admin_set_plan(%L, ''askida'', null, null)', o1));
  perform pg_temp.as_user(up);
  perform pg_temp.ok('A-4 platform admin salonları listeler', (select count(*) from public.admin_list_orgs()) >= 2);
  perform pg_temp.fails('A-4 geçersiz plan reddedilir',
    format('select public.admin_set_plan(%L, ''gold'', now() + interval ''30 days'', null)', o1));
  perform pg_temp.fails('A-4 aktif plan paid_until zorunlu',
    format('select public.admin_set_plan(%L, ''aktif'', null, null)', o1));
  perform pg_temp.fails('A-4 paid_until en fazla +2 yıl',
    format('select public.admin_set_plan(%L, ''aktif'', now() + interval ''3 years'', null)', o1));
  perform public.admin_set_plan(o1, 'aktif', now() + interval '60 days', 'fatura-gizli');
  perform pg_temp.ok('A-4 admin_set_plan planı günceller', (select plan from public.orgs where id = o1) = 'aktif');
  perform pg_temp.ok('A-4 admin_set_plan denetim satırı yazar',
    exists (select 1 from public.audit_log where action = 'admin_set_plan' and entity_id = o1::text));

  -- A-3: Faturalama notu gizliliği (org_billing)
  perform pg_temp.ok('A-3 admin_set_plan notu org_billing yazar',
    (select notes from public.org_billing where org_id = o1) = 'fatura-gizli');
  perform pg_temp.as_user(ua);
  perform pg_temp.ok('A-3 sahip org_billing okuyamaz', (select count(*) from public.org_billing) = 0);
  perform pg_temp.ok('A-3 sahip audit_log içinde fatura notunu göremez',
    not exists (select 1 from public.audit_log where org_id = o1 and details::text ilike '%fatura-gizli%'));
  perform pg_temp.as_user(uc);
  perform pg_temp.ok('A-3 sporcu org_billing okuyamaz', (select count(*) from public.org_billing) = 0);
  perform pg_temp.fails('A-3 sporcu org_billing yazamaz',
    format('insert into public.org_billing (org_id, notes) values (%L, ''sızma'')', o1));
  perform pg_temp.as_user(up);
  perform pg_temp.ok('A-3 platform admin org_billing okur',
    (select notes from public.org_billing where org_id = o1) = 'fatura-gizli');
  update public.org_billing set notes = 'guncel-not' where org_id = o1;
  perform pg_temp.ok('A-3 platform admin org_billing günceller',
    (select notes from public.org_billing where org_id = o1) = 'guncel-not');
  perform pg_temp.ok('A-3 admin_list_orgs fatura notu sızdırmaz',
    not exists (select 1 from public.admin_list_orgs() r where r::text ilike '%guncel-not%'));
  perform public.admin_set_plan(o1, 'deneme', null, null);
end $$;

select n, case when ok then 'GECTI' else 'KALDI' end as sonuc, name, left(coalesce(detail, ''), 120) as ayrinti from t_result order by n;
select count(*) filter (where ok) as gecti, count(*) filter (where not ok) as kaldi from t_result;
rollback;
