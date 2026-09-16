-- ============================================================
-- Postgres grants EXECUTE to PUBLIC on every new function, so each one added
-- here has been reachable by the anon key unless explicitly revoked. Most were
-- harmless (security invoker, RLS still applies, auth.uid() is null), but
-- user_metrics(uuid) is SECURITY DEFINER and took a user id — anyone with the
-- browser key could read any account's streak and mastered count.
--
-- Revoke from PUBLIC across the board, then grant back deliberately.
-- ============================================================
do $lock$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'sm2_next','review_card','undo_last_review','set_card_suspended',
        'get_study_queue','get_suspended_words','get_quiz_options','get_pos_list',
        'get_stats','search_words','clean_headword','change_password',
        'is_pro','my_plan','plan_of','extend_pro','user_metrics',
        'get_my_badges','get_leaderboard','set_username','my_account',
        'username_available','legacy_login_email','get_billing_config',
        'handle_new_user','register_user')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
  end loop;
end;
$lock$;

-- Signed-out visitors need exactly three things: to check a username while
-- signing up, to resolve a legacy username at sign-in, and to read the prices.
grant execute on function public.username_available(text)   to anon, authenticated;
grant execute on function public.legacy_login_email(text)   to anon;
grant execute on function public.get_billing_config()       to anon, authenticated;

-- Everything a signed-in user drives.
grant execute on function
  public.review_card(uuid, int, text),
  public.undo_last_review(),
  public.set_card_suspended(uuid, boolean),
  public.get_study_queue(int, text[], text[]),
  public.get_suspended_words(text, int),
  public.get_quiz_options(uuid),
  public.get_pos_list(),
  public.get_stats(),
  public.search_words(text, text[], int, int),
  public.change_password(text, text),
  public.set_username(text),
  public.my_account(),
  public.my_plan(),
  public.get_my_badges(),
  public.get_leaderboard(text, int)
to authenticated;

-- is_pro / plan_of / user_metrics / sm2_next / clean_headword / extend_pro /
-- handle_new_user / register_user stay unreachable over the API. The functions
-- that need them call them internally, where the grant does not apply.;
