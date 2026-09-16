-- ============================================================
-- The entitlement helpers were a dilemma in `public`: revoking EXECUTE kept
-- anon out but also broke the SECURITY INVOKER functions that call them, while
-- granting it re-exposed user_metrics(uuid) — a SECURITY DEFINER function
-- taking any user id — over /rest/v1/rpc.
--
-- PostgREST only exposes `public`, so move them somewhere it cannot see. The
-- callers reach them by qualified name; the API cannot reach them at all.
-- ============================================================
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated, service_role;

create or replace function app_private.is_pro(p_user uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select coalesce((select pro_until > now() from public.profiles where id = p_user), false);
$fn$;

create or replace function app_private.plan_of(p_user uuid)
returns public.plan_limits
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select * from public.plan_limits
  where plan = case when app_private.is_pro(p_user) then 'pro' else 'free' end;
$fn$;

create or replace function app_private.user_metrics(p_user uuid)
returns table (streak int, mastered int, reviews_total int, suspended int,
               days_studied int, reviews_week int)
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  with tz as (select coalesce((select timezone from public.profiles where id = p_user),
                              'Asia/Bangkok') as z),
  today as (select (now() at time zone (select z from tz))::date as d),
  days as (
    select (reviewed_at at time zone (select z from tz))::date as d, count(*) as n
    from public.reviews where user_id = p_user
    group by 1
  ),
  anchor as (
    select case when exists (select 1 from days where d = (select d from today))
                then (select d from today) else (select d from today) - 1 end as a
  ),
  streak as (
    select count(*)::int as len from (
      select d, d + (row_number() over (order by d desc))::int as grp
      from days where d <= (select a from anchor)
    ) s where grp = (select a from anchor) + 1
  ),
  cards as (
    select count(*) filter (where status = 'mastered')::int  as mastered,
           count(*) filter (where status = 'suspended')::int as suspended
    from public.card_states where user_id = p_user
  )
  select coalesce((select len from streak), 0),
         coalesce((select mastered from cards), 0),
         (select count(*)::int from public.reviews where user_id = p_user),
         coalesce((select suspended from cards), 0),
         (select count(*)::int from days),
         (select coalesce(sum(n), 0)::int from days where d > (select d from today) - 7);
$fn$;

grant execute on function
  app_private.is_pro(uuid), app_private.plan_of(uuid), app_private.user_metrics(uuid)
to authenticated, service_role;

-- the public copies are what PostgREST could see; they are no longer needed
drop function if exists public.user_metrics(uuid);
drop function if exists public.plan_of(uuid);
drop function if exists public.my_plan();
drop function if exists public.is_pro(uuid);

-- review_card calls sm2_next as the invoker, so that one does need the grant.
-- It is pure arithmetic over its arguments and reads nothing.
grant execute on function public.sm2_next(int, int, numeric, int) to authenticated;

-- the webhook runs as service_role and must be able to grant time
grant execute on function public.extend_pro(uuid, int) to service_role;;
