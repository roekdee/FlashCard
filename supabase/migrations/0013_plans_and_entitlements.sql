-- ============================================================
-- Free / Pro entitlements.
--
-- Pro is an expiry date, not a subscription state machine. Omise can only
-- auto-renew a saved card; PromptPay is one-time. Both end up doing the same
-- thing here — a successful charge pushes pro_until further out — so the two
-- payment methods need no separate handling and a failed renewal degrades to
-- Free on its own.
-- ============================================================

alter table public.profiles
  add column if not exists pro_until timestamptz,
  add column if not exists show_on_leaderboard boolean not null default true,
  add column if not exists display_name text;

create index if not exists profiles_pro_until_idx on public.profiles (pro_until);

-- ---------- what Free gets ----------
create table if not exists public.plan_limits (
  plan            text primary key check (plan in ('free','pro')),
  new_per_day_cap int,          -- null = no cap
  levels          text[],       -- null = every level
  modes           text[],
  full_stats      boolean not null default false,
  leaderboard     boolean not null default false
);

insert into public.plan_limits (plan, new_per_day_cap, levels, modes, full_stats, leaderboard)
values
  ('free', 10,   array['A1','A2'], array['flip'],                 false, false),
  ('pro',  null, null,             array['flip','quiz','typing'], true,  true)
on conflict (plan) do update set
  new_per_day_cap = excluded.new_per_day_cap,
  levels          = excluded.levels,
  modes           = excluded.modes,
  full_stats      = excluded.full_stats,
  leaderboard     = excluded.leaderboard;

alter table public.plan_limits enable row level security;
drop policy if exists plan_limits_read on public.plan_limits;
create policy plan_limits_read on public.plan_limits
  for select to anon, authenticated using (true);   -- the pricing page needs it

-- ---------- entitlement helpers ----------
create or replace function public.is_pro(p_user uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select coalesce((select pro_until > now() from public.profiles where id = p_user), false);
$fn$;

create or replace function public.my_plan()
returns text
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  select case when public.is_pro() then 'pro' else 'free' end;
$fn$;

create or replace function public.plan_of(p_user uuid)
returns public.plan_limits
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select * from public.plan_limits
  where plan = case when public.is_pro(p_user) then 'pro' else 'free' end;
$fn$;

-- ---------- payment ledger ----------
-- charge_id is unique so a webhook replay cannot extend anyone twice.
create table if not exists public.billing_events (
  id            bigint generated always as identity primary key,
  user_id       uuid references auth.users (id) on delete set null,
  provider      text not null default 'omise',
  charge_id     text not null unique,
  status        text not null,
  amount_satang int  not null,
  currency      text not null default 'THB',
  months        int  not null default 1,
  method        text,
  pro_until_after timestamptz,
  raw           jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists billing_events_user_idx on public.billing_events (user_id, created_at desc);

alter table public.billing_events enable row level security;
drop policy if exists billing_events_read_own on public.billing_events;
create policy billing_events_read_own on public.billing_events
  for select to authenticated using (user_id = (select auth.uid()));
-- inserts only ever come from the webhook, which uses the service role

-- ---------- what the pricing / billing screen needs ----------
create table if not exists public.billing_plans (
  code          text primary key,
  months        int  not null,
  amount_satang int  not null,
  label_th      text not null,
  badge_th      text,
  sort          int  not null default 0,
  active        boolean not null default true
);

insert into public.billing_plans (code, months, amount_satang, label_th, badge_th, sort) values
  ('pro_1m',  1,   9900, 'Pro 1 เดือน',  null,            1),
  ('pro_6m',  6,  49900, 'Pro 6 เดือน',  'ประหยัด 16%',   2),
  ('pro_12m', 12, 89900, 'Pro 1 ปี',     'ประหยัด 25%',   3)
on conflict (code) do nothing;

alter table public.billing_plans enable row level security;
drop policy if exists billing_plans_read on public.billing_plans;
create policy billing_plans_read on public.billing_plans
  for select to anon, authenticated using (active);

-- Omise's publishable key is safe in the browser, but keeping it here means the
-- owner sets it once in SQL instead of editing and redeploying the frontend.
alter table public.app_settings
  add column if not exists omise_public_key text,
  add column if not exists billing_live boolean not null default false;

create or replace function public.get_billing_config()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
    'omise_public_key', (select omise_public_key from public.app_settings where id),
    'live',             coalesce((select billing_live from public.app_settings where id), false),
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

grant execute on function public.get_billing_config() to anon, authenticated;
grant execute on function public.is_pro(uuid), public.my_plan() to authenticated;;
