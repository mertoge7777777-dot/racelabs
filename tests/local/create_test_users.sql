-- Uçtan uca test hesapları (tests/e2e.js için). Şifre: RaceLab-Test-2026!
-- YALNIZ TEST ORTAMI. Canlıda çalıştırma.
do $$
declare r record;
begin
  for r in select * from (values ('rl-e2e-sahip@example.test'), ('rl-e2e-hakem@example.test'), ('rl-e2e-sporcu@example.test')) v(email) loop
    if not exists (select 1 from auth.users where email = r.email) then
      with u as (
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
        values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', r.email, extensions.crypt('RaceLab-Test-2026!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', '')
        returning id, email
      )
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      select gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now() from u;
    end if;
  end loop;
end $$;
