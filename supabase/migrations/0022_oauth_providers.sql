-- ============================================================
-- 0021 gated the Google button on a single boolean. Adding a second provider
-- that way means another column, another branch in get_billing_config and
-- another branch in the client for every one of them.
--
-- Keep the same idea — never show a button for a provider that is not turned
-- on in the dashboard, because signInWithOAuth navigates away instead of
-- rejecting, so a dead button cannot be caught client side — but hold the
-- answer as a list. Turning a provider on is then one UPDATE and no code.
--
-- google_enabled stays as the source of truth for Google so nothing that
-- already reads it breaks; the list is derived from it on the way out.
-- ============================================================
alter table public.app_settings
  add column if not exists oauth_providers text[] not null default '{}';

-- Whatever Google was set to keeps working without a second switch to flip.
update public.app_settings
   set oauth_providers = array['google']
 where google_enabled and not ('google' = any (oauth_providers));

create or replace function public.get_billing_config()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
    'omise_public_key', (select omise_public_key from public.app_settings where id),
    'live',             coalesce((select billing_live   from public.app_settings where id), false),
    'google_enabled',   coalesce((select google_enabled from public.app_settings where id), false),
    'oauth_providers',  coalesce((
      select to_jsonb(
        case when s.google_enabled and not ('google' = any (s.oauth_providers))
             then array['google'] || s.oauth_providers
             else s.oauth_providers end)
      from public.app_settings s where s.id), '[]'::jsonb),
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
