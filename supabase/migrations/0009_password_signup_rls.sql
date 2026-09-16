-- ============================================================
-- Let people change their own password, put sign-up behind a switch, and
-- close the RLS hole on the unused tables sharing this database.
-- ============================================================

-- ---------- change your own password ----------
-- Accounts carried over from the spreadsheet still use the password that was
-- sitting in that sheet, and one of them is five characters long. There was no
-- way to change it from inside the app.
create or replace function public.change_password(p_current text, p_new text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions, pg_temp
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_hash text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_new is null or length(p_new) < 8 then
    raise exception 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร';
  end if;
  if p_new = p_current then
    raise exception 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม';
  end if;

  select encrypted_password into v_hash from auth.users where id = v_uid;
  if v_hash is null or extensions.crypt(p_current, v_hash) <> v_hash then
    raise exception 'รหัสผ่านเดิมไม่ถูกต้อง';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_new, extensions.gen_salt('bf')),
         updated_at = now()
   where id = v_uid;

  return jsonb_build_object('ok', true);
end;
$fn$;

revoke all on function public.change_password(text, text) from public, anon;
grant execute on function public.change_password(text, text) to authenticated;

-- ---------- a switch for open sign-up ----------
-- The site is public, so anyone can reach the sign-up form. Leave it on by
-- default, but make turning it off `update public.app_settings set
-- allow_signup = false` rather than a REVOKE that fails with an opaque
-- permission error the app cannot explain to the user.
create table if not exists public.app_settings (
  id           boolean primary key default true check (id),
  allow_signup boolean not null default true,
  updated_at   timestamptz not null default now()
);

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

alter table public.app_settings enable row level security;
-- deliberately no policies: only SECURITY DEFINER functions read this table

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
  if not coalesce((select allow_signup from public.app_settings where id), true) then
    raise exception 'ระบบปิดรับสมัครสมาชิกใหม่อยู่';
  end if;
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
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('username', v_username), now(), now(),
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

revoke all on function public.register_user(text, text) from public, authenticated;
grant execute on function public.register_user(text, text) to anon;

-- ---------- close the RLS hole on the abandoned tables ----------
-- These belong to an earlier project sharing this database. pg_stat_user_tables
-- reported 0 rows, 0 sequential scans, 0 index scans and 0 inserts on every one
-- of them — nothing has ever read or written them — yet the anon key could read
-- and write them all.
--
-- Enabling RLS with no policy denies anon and authenticated outright, which is
-- the right default for an unused table. If that project is revived it needs
-- its own policies, or `alter table ... disable row level security`.
do $rls$
declare t text;
begin
  foreach t in array array[
    'users','accounts','sessions','verification_tokens','courses','units','lessons',
    'content_sections','exercises','user_progress','exercise_attempts','mistakes',
    'daily_missions','user_badges','spaced_repetition_cards','study_plans',
    'study_plan_tasks','mock_exam_results','writing_submissions','arena_matches','arena_rooms'
  ] loop
    if to_regclass('public.' || quote_ident(t)) is not null then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end;
$rls$;
