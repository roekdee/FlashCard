-- ============================================================
-- One-time import from the old Google Sheet. Safe to skip on a fresh
-- install: it does nothing unless the two staging tables exist.
--
-- To replay it, load the spreadsheet exports into:
--   legacy_users(user_key text, username text, password text)
--   legacy_state(user_key text, word_id uuid, learned bool, hidden bool)
-- then run this file.
-- ============================================================
do $mig$
begin
  if to_regclass('public.legacy_users') is null
     or to_regclass('public.legacy_state') is null then
    raise notice 'no staging tables — nothing to migrate';
    return;
  end if;

  -- Accounts keep their old username and password. Passwords were plain text
  -- in the spreadsheet and are bcrypt hashed on the way in. The email is
  -- synthetic: the app signs in by username (see public.register_user).
  --
  -- The blank strings below matter: GoTrue scans these columns into Go
  -- strings, and a NULL makes every later sign-in fail with
  -- "Database error querying schema".
  with created as (
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token,
      is_sso_user, is_anonymous
    )
    select
      '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
      'authenticated', 'authenticated',
      lu.username || '@oxford3000.local',
      extensions.crypt(lu.password, extensions.gen_salt('bf')),
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('username', lu.username, 'legacy_id', lu.user_key),
      now(), now(),
      '', '', '', '', '', '', '', '', false, false
    from public.legacy_users lu
    where not exists (
      select 1 from auth.users u where u.email = lu.username || '@oxford3000.local')
    returning id, email
  )
  insert into auth.identities (provider_id, user_id, identity_data, provider,
                               last_sign_in_at, created_at, updated_at)
  select c.id::text, c.id,
         jsonb_build_object('sub', c.id::text, 'email', c.email, 'email_verified', true),
         'email', now(), now(), now()
  from created c;

  insert into public.profiles (id, username)
  select u.id, u.raw_user_meta_data ->> 'username'
  from auth.users u
  where u.raw_user_meta_data ? 'legacy_id'
  on conflict (id) do nothing;

  -- hidden_forever -> suspended ("จำได้แล้ว"); learned -> a real card due tomorrow.
  -- Rows that were neither are dropped on purpose: they were only ever "seen",
  -- and a card_states row would hide the word from both the due and new queues.
  -- created_at must be backdated. The daily new-card cap in 0008 counts rows
  -- created today as "introduced today", so importing months of old progress
  -- with a default now() spends the whole budget before the user studies
  -- anything. (This is what migration 0012 had to repair.)
  insert into public.card_states (
    user_id, word_id, status, repetitions, interval_days, ease_factor,
    due_at, created_at, updated_at)
  select p.id, ls.word_id,
         case when ls.hidden then 'suspended' else 'review' end,
         case when ls.hidden then 0 else 1 end,
         case when ls.hidden then 0 else 1 end,
         2.50,
         case when ls.hidden then null else now() + interval '1 day' end,
         now() - interval '180 days',
         now()
  from public.legacy_state ls
  join public.legacy_users lu on lu.user_key = ls.user_key
  join public.profiles p on p.username = lu.username
  join public.words w on w.id = ls.word_id
  where ls.hidden or ls.learned
  on conflict (user_id, word_id) do nothing;

  drop table public.legacy_state;
  drop table public.legacy_users;
end;
$mig$;
