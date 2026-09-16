-- ============================================================
-- Database linter follow-ups for this app's own functions.
-- ============================================================

-- 1. pin search_path on the two helpers that were missing it
alter function public.sm2_next(int, int, numeric, int) set search_path = pg_catalog, pg_temp;
alter function public.clean_headword(text)             set search_path = pg_catalog, pg_temp;

-- 2. handle_new_user is a trigger; nobody should reach it over /rest/v1/rpc
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- 3. register_user is for signed-out visitors only
revoke all on function public.register_user(text, text) from public, authenticated;
grant execute on function public.register_user(text, text) to anon;
