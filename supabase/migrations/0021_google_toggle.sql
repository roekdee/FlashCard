-- ============================================================
-- The Google button was shown unconditionally, so until the provider is
-- enabled in the Supabase dashboard every visitor who pressed it was sent to
-- GoTrue and met a raw
--   {"code":400,"error_code":"validation_failed",
--    "msg":"Unsupported provider: provider is not enabled"}
--
-- signInWithOAuth navigates away rather than rejecting, so the client cannot
-- catch that. Gate the button on a flag instead, flipped in the same place the
-- Omise key is set, and there is no dead button in front of anyone.
-- ============================================================
alter table public.app_settings
  add column if not exists google_enabled boolean not null default false;

create or replace function public.get_billing_config()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
    'omise_public_key', (select omise_public_key from public.app_settings where id),
    'live',             coalesce((select billing_live   from public.app_settings where id), false),
    'google_enabled',   coalesce((select google_enabled from public.app_settings where id), false),
    'allow_signup',     coalesce((select allow_signup   from public.app_settings where id), true),
    'plans',            coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', code, 'months', months, 'amount_satang', amount_satang,
        'label_th', label_th, 'badge_th', badge_th) order by sort)
      from public.billing_plans where active), '[]'::jsonb),
    'limits',           coalesce((
      select jsonb_object_agg(plan, jsonb_build_object(
        'new_per_day_cap', new_per_day_cap, 'levels', levels,
        'modes', modes, 'full_stats', full_stats, 'leaderboard', leaderboard))
      from public.plan_limits), '{}'::jsonb)
  );
$fn$;

revoke all on function public.get_billing_config() from public;
grant execute on function public.get_billing_config() to anon, authenticated;
