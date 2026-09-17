-- Turning an intent into Pro time. Only service_role reaches this (see 0026),
-- so the browser cannot mark its own payment as paid however the verifier
-- behaves.
--
-- The unique index on slip_ref is what actually stops a slip being replayed:
-- the second attempt fails the insert, not a check we remembered to write.
create or replace function public.settle_promptpay(
  p_intent   uuid,
  p_slip_ref text,
  p_raw      jsonb default null,
  p_note     text  default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  v_intent public.payment_intents%rowtype;
  v_until  timestamptz;
begin
  select * into v_intent from public.payment_intents
   where id = p_intent for update;
  if not found then
    raise exception 'no such payment';
  end if;
  if v_intent.status = 'paid' then
    -- Already done. Say so rather than granting a second month.
    return jsonb_build_object('already', true, 'status', 'paid');
  end if;
  if v_intent.status <> 'pending' then
    raise exception 'payment is %', v_intent.status;
  end if;

  update public.payment_intents
     set status = 'paid', slip_ref = p_slip_ref, slip_raw = p_raw,
         note = p_note, settled_at = now()
   where id = p_intent;

  v_until := public.extend_pro(v_intent.user_id, v_intent.months);

  insert into public.billing_events
    (user_id, provider, charge_id, status, amount_satang, currency,
     months, method, pro_until_after, raw)
  values
    (v_intent.user_id, 'promptpay', coalesce(p_slip_ref, p_intent::text),
     'successful', v_intent.amount_satang, 'thb',
     v_intent.months, 'promptpay', v_until, p_raw);

  return jsonb_build_object('status', 'paid', 'pro_until', v_until,
                            'months', v_intent.months);
end;
$fn$;

revoke all on function public.settle_promptpay(uuid, text, jsonb, text) from public;

-- The owner's own escape hatch, for when the verifier is down or wrong.
create or replace function public.reject_promptpay(p_intent uuid, p_note text)
returns void
language sql security definer
set search_path = public, pg_temp
as $fn$
  update public.payment_intents
     set status = 'rejected', note = p_note, settled_at = now()
   where id = p_intent and status = 'pending';
$fn$;

revoke all on function public.reject_promptpay(uuid, text) from public;
