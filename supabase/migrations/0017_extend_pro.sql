-- Grant Pro time. Called only by the omise-webhook function with the service
-- role; anon and authenticated must never reach it, or anyone with the browser
-- key could hand themselves a subscription.
create or replace function public.extend_pro(p_user uuid, p_months int)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_until timestamptz;
begin
  if p_months is null or p_months < 1 or p_months > 36 then
    raise exception 'months out of range';
  end if;

  -- extend from whichever is later: now, or time already paid for
  update public.profiles
     set pro_until = greatest(coalesce(pro_until, now()), now())
                     + make_interval(months => p_months)
   where id = p_user
  returning pro_until into v_until;

  if v_until is null then
    raise exception 'no profile for %', p_user;
  end if;
  return v_until;
end;
$fn$;

revoke all on function public.extend_pro(uuid, int) from public, anon, authenticated;

-- A place for the owner to comp an account without touching SQL by hand twice.
comment on function public.extend_pro(uuid, int) is
  'Service-role only. Webhook grants Pro time; also usable from the SQL editor: select public.extend_pro(''<user-uuid>'', 1);';;
