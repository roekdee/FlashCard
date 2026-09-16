-- ============================================================
-- Sign-up by username.
--
-- The app identifies people by username, so accounts use a synthetic
-- <username>@oxford3000.local address. GoTrue's own /signup refuses that
-- domain (it validates the TLD) and, on the free tier, would try to send a
-- confirmation mail capped at roughly two per hour — so sign-up runs here
-- instead. Sign-in afterwards is ordinary Supabase Auth.
-- ============================================================
create or replace function public.register_user(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions, pg_temp
as $fn$
declare
  v_username text := lower(trim(p_username));
  v_email    text;
  v_id       uuid := gen_random_uuid();
begin
  if v_username !~ '^[a-z0-9_]{3,32}$' then
    raise exception 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z, 0-9, _ และยาว 3-32 ตัวอักษร';
  end if;
  if p_password is null or length(p_password) < 8 then
    raise exception 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร';
  end if;

  v_email := v_username || '@oxford3000.local';

  if exists (select 1 from auth.users where email = v_email)
     or exists (select 1 from public.profiles where username = v_username) then
    raise exception 'ชื่อผู้ใช้นี้ถูกใช้แล้ว';
  end if;

  -- Blunt abuse cap: this is a personal study app, not a public service.
  if (select count(*) from auth.users) >= 500 then
    raise exception 'ระบบรับสมาชิกเต็มแล้ว';
  end if;

  -- The blank strings are required: GoTrue scans these columns into Go strings
  -- and a NULL breaks every later sign-in with "Database error querying schema".
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token,
    is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id,
    'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('username', v_username),
    now(), now(),
    '', '', '', '', '', '', '', '', false, false
  );

  insert into auth.identities (provider_id, user_id, identity_data, provider,
                               last_sign_in_at, created_at, updated_at)
  values (v_id::text, v_id,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', now(), now(), now());

  insert into public.profiles (id, username) values (v_id, v_username)
  on conflict (id) do nothing;

  return jsonb_build_object('ok', true, 'email', v_email);
end;
$fn$;

revoke all on function public.register_user(text, text) from public;
grant execute on function public.register_user(text, text) to anon;
