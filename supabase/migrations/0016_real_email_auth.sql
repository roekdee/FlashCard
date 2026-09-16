-- ============================================================
-- Move to real email addresses.
--
-- Password reset, receipts and Google sign-in all need auth.users.email to be
-- somewhere a person actually reads, so new accounts use supabase.auth.signUp
-- directly and register_user is retired for them. The four accounts carried
-- over from the spreadsheet keep working on username until they add an email.
-- ============================================================

-- ---------- usernames ----------
create or replace function public.username_available(p_username text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select lower(trim(p_username)) ~ '^[a-z0-9_]{3,32}$'
     and not exists (select 1 from public.profiles
                     where username = lower(trim(p_username)));
$fn$;

grant execute on function public.username_available(text) to anon, authenticated;

-- A signup must never fail because a username was taken between the check and
-- the submit, so fall back to a suffixed one and let the person rename later.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_base text;
  v_name text;
  v_try  int := 0;
begin
  v_base := lower(coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'preferred_username'), ''),
    split_part(new.email, '@', 1)));
  v_base := regexp_replace(v_base, '[^a-z0-9_]', '', 'g');
  if char_length(v_base) < 3 then
    v_base := 'user' || v_base;
  end if;
  v_base := left(v_base, 28);

  v_name := v_base;
  while exists (select 1 from public.profiles where username = v_name) loop
    v_try := v_try + 1;
    v_name := v_base || v_try::text;
    exit when v_try > 9999;
  end loop;

  insert into public.profiles (id, username, display_name)
  values (new.id, v_name, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''))
  on conflict (id) do nothing;

  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ---------- rename yourself ----------
create or replace function public.set_username(p_username text)
returns jsonb
language plpgsql security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_name text := lower(trim(p_username));
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if v_name !~ '^[a-z0-9_]{3,32}$' then
    raise exception 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z, 0-9, _ และยาว 3-32 ตัวอักษร';
  end if;
  if exists (select 1 from public.profiles where username = v_name and id <> v_uid) then
    raise exception 'ชื่อผู้ใช้นี้ถูกใช้แล้ว';
  end if;

  update public.profiles set username = v_name where id = v_uid;
  return jsonb_build_object('ok', true, 'username', v_name);
end;
$fn$;

grant execute on function public.set_username(text) to authenticated;

-- ---------- the legacy username login path ----------
-- Resolves a username to its sign-in address, but ONLY while that address is
-- still the synthetic one. Once a real email is attached the lookup stops
-- answering, so this can never be used to discover somebody's real address.
create or replace function public.legacy_login_email(p_username text)
returns text
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select u.email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.username = lower(trim(p_username))
    and u.email like '%@oxford3000.local';
$fn$;

grant execute on function public.legacy_login_email(text) to anon;

-- ---------- does this account still need a real email? ----------
create or replace function public.my_account()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
    'username',      p.username,
    'display_name',  p.display_name,
    'email',         case when u.email like '%@oxford3000.local' then null else u.email end,
    'needs_email',   u.email like '%@oxford3000.local',
    'provider',      coalesce(u.raw_app_meta_data ->> 'provider', 'email'),
    'pro_until',     p.pro_until,
    'is_pro',        coalesce(p.pro_until > now(), false),
    'show_on_leaderboard', p.show_on_leaderboard,
    'daily_goal',    p.daily_goal,
    'new_per_day',   p.new_per_day,
    'timezone',      p.timezone
  )
  from public.profiles p join auth.users u on u.id = p.id
  where p.id = auth.uid();
$fn$;

grant execute on function public.my_account() to authenticated;

-- ---------- retire self-serve register_user ----------
-- Accounts now come from supabase.auth.signUp with a real address. Keeping a
-- SECURITY DEFINER function that writes auth.users and is callable by anyone
-- who has the browser key is not worth it once nothing needs it.
revoke all on function public.register_user(text, text) from public, anon, authenticated;

update public.app_settings set allow_signup = true where id;;
