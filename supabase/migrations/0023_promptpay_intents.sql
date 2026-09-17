-- PromptPay: the payer scans a QR and we learn nothing until they show us the
-- slip, so an intent records what was asked for BEFORE any money moves. The
-- slip is then checked against that row rather than against whatever the
-- client claims it paid.
alter table public.app_settings
  add column if not exists promptpay_id   text,
  add column if not exists promptpay_name text,
  add column if not exists promptpay_live boolean not null default false;

create table if not exists public.payment_intents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  plan_code     text not null references public.billing_plans(code),
  months        integer not null,
  amount_satang integer not null,
  status        text not null default 'pending'
                check (status in ('pending','paid','rejected','expired')),
  slip_ref      text,
  slip_raw      jsonb,
  note          text,
  created_at    timestamptz not null default now(),
  settled_at    timestamptz
);

-- One slip can only ever pay for one intent, whatever any verifier says.
create unique index if not exists payment_intents_slip_ref_key
  on public.payment_intents (slip_ref) where slip_ref is not null;

create index if not exists payment_intents_user_idx
  on public.payment_intents (user_id, created_at desc);

alter table public.payment_intents enable row level security;

drop policy if exists payment_intents_own_select on public.payment_intents;
create policy payment_intents_own_select on public.payment_intents
  for select to authenticated using (user_id = auth.uid());

-- No insert/update/delete policy on purpose: rows are only written by the
-- SECURITY DEFINER function below and by the Edge Function's service_role.

-- ---------- start a payment ----------
-- Price and months come from billing_plans, never from the caller.
create or replace function public.start_promptpay(p_plan_code text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  v_plan   public.billing_plans%rowtype;
  v_intent public.payment_intents%rowtype;
  v_pp     text;
  v_live   boolean;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  select * into v_plan from public.billing_plans
   where code = p_plan_code and active;
  if not found then
    raise exception 'unknown plan %', p_plan_code;
  end if;

  select promptpay_id, promptpay_live into v_pp, v_live
    from public.app_settings where id;
  if v_pp is null or not v_live then
    raise exception 'promptpay is not switched on yet' using errcode = '42501';
  end if;

  -- Stale intents are closed so a later slip cannot be matched to one by
  -- accident.
  update public.payment_intents
     set status = 'expired'
   where user_id = auth.uid()
     and status = 'pending'
     and created_at < now() - interval '2 hours';

  insert into public.payment_intents (user_id, plan_code, months, amount_satang)
  values (auth.uid(), v_plan.code, v_plan.months, v_plan.amount_satang)
  returning * into v_intent;

  return jsonb_build_object(
    'intent_id',     v_intent.id,
    'amount_satang', v_intent.amount_satang,
    'months',        v_intent.months,
    'label_th',      v_plan.label_th,
    'promptpay_id',  v_pp
  );
end;
$fn$;

revoke all on function public.start_promptpay(text) from public;
grant execute on function public.start_promptpay(text) to authenticated;

-- ---------- what happened to my payment ----------
create or replace function public.my_payments()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'plan_code', plan_code, 'amount_satang', amount_satang,
    'status', status, 'note', note,
    'created_at', created_at, 'settled_at', settled_at) order by created_at desc), '[]'::jsonb)
  from public.payment_intents
  where user_id = auth.uid();
$fn$;

revoke all on function public.my_payments() from public;
grant execute on function public.my_payments() to authenticated;
