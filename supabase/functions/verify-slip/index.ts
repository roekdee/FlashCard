// Checks a PromptPay slip against the intent the payer started, then hands
// the result to settle_promptpay. Nothing the browser sends decides the
// outcome: the amount and the plan come from the intent row, and the receiver
// account is compared against app_settings.
//
// The verifier is whatever SLIP_VERIFY_URL points at, so it can be swapped
// without touching this file. When it is unset or unreachable the payment is
// left pending for the owner to approve by hand rather than granted.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VERIFY_URL   = Deno.env.get('SLIP_VERIFY_URL') ?? 'https://api.nearbyshop.xyz/api/v1/verify';
const VERIFY_TOKEN = Deno.env.get('SLIP_VERIFY_TOKEN');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' }
  });

/** Keep only digits, so 081-234-5678 and 0812345678 compare equal. */
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/**
 * Thai slips mask the receiver account as xxx-x-x1234-x, so an exact match is
 * impossible. Comparing the last four digits is what the banks' own apps show
 * and is enough once the amount and the reference must also line up.
 */
function receiverLooksRight(payload: unknown, expected: string): boolean {
  const want = digits(expected).slice(-4);
  if (want.length < 4) return false;
  const hay = JSON.stringify(payload ?? {});
  for (const m of hay.matchAll(/[0-9xX*\-]{6,}/g)) {
    if (digits(m[0]).slice(-4) === want) return true;
  }
  return false;
}

/** Pull the bank's transaction reference out of whatever shape came back. */
function slipRef(payload: any): string | null {
  const c = payload?.data ?? payload ?? {};
  const v = c.transRef ?? c.transactionId ?? c.ref ?? c.transaction_ref ??
            c.receivingBank?.ref ?? c.sendingBank?.ref ?? null;
  return v ? String(v) : null;
}

/** Slips report baht as a number; we hold satang as an integer. */
function amountSatang(payload: any): number | null {
  const c = payload?.data ?? payload ?? {};
  const v = c.amount?.amount ?? c.amount ?? c.total ?? null;
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST')    return json({ error: 'POST only' }, 405);

  // Who is asking. verify_jwt is on, but read the user anyway so the intent
  // can be checked against them rather than against a body field.
  const auth = req.headers.get('Authorization') ?? '';
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: { user }, error: userErr } =
    await admin.auth.getUser(auth.replace('Bearer ', ''));
  if (userErr || !user) return json({ error: 'sign in first' }, 401);

  let body: { intent_id?: string; qr_payload?: string; image_base64?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  if (!body.intent_id) return json({ error: 'intent_id required' }, 400);
  if (!body.qr_payload && !body.image_base64) {
    return json({ error: 'send the slip QR payload or the slip image' }, 400);
  }

  const { data: intent } = await admin
    .from('payment_intents')
    .select('id, user_id, amount_satang, months, status')
    .eq('id', body.intent_id)
    .maybeSingle();

  if (!intent)                    return json({ error: 'no such payment' }, 404);
  if (intent.user_id !== user.id) return json({ error: 'not your payment' }, 403);
  if (intent.status === 'paid')   return json({ status: 'paid', already: true });
  if (intent.status !== 'pending') return json({ error: `payment is ${intent.status}` }, 409);

  const { data: settings } = await admin
    .from('app_settings')
    .select('promptpay_id')
    .maybeSingle();
  if (!settings?.promptpay_id) return json({ error: 'promptpay not configured' }, 503);

  if (!VERIFY_TOKEN) {
    // No verifier wired up: keep the money claim, let the owner decide.
    return json({ status: 'pending_review',
                  message: 'ส่งสลิปแล้ว รอตรวจสอบ' });
  }

  let payload: any;
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json',
                 authorization: `Bearer ${VERIFY_TOKEN}` },
      body: JSON.stringify(body.qr_payload
        ? { payload: body.qr_payload }
        : { image: body.image_base64 })
    });
    payload = await res.json();
    if (!res.ok) {
      return json({ status: 'pending_review',
                    message: 'ตรวจสลิปอัตโนมัติไม่สำเร็จ รอตรวจสอบด้วยคนแทน' });
    }
  } catch {
    return json({ status: 'pending_review',
                  message: 'ตรวจสลิปอัตโนมัติไม่สำเร็จ รอตรวจสอบด้วยคนแทน' });
  }

  const ref  = slipRef(payload);
  const paid = amountSatang(payload);

  if (!ref) {
    return json({ status: 'pending_review',
                  message: 'อ่านเลขอ้างอิงจากสลิปไม่ได้ รอตรวจสอบด้วยคน' });
  }
  if (paid !== intent.amount_satang) {
    return json({ error: `ยอดเงินไม่ตรง — ต้องโอน ${(intent.amount_satang / 100).toFixed(2)} บาท`,
                  status: 'amount_mismatch' }, 400);
  }
  if (!receiverLooksRight(payload, settings.promptpay_id)) {
    return json({ error: 'บัญชีผู้รับไม่ตรงกับพร้อมเพย์ของร้าน',
                  status: 'receiver_mismatch' }, 400);
  }

  const { data: settled, error: settleErr } = await admin.rpc('settle_promptpay', {
    p_intent: intent.id, p_slip_ref: ref, p_raw: payload, p_note: 'auto'
  });

  if (settleErr) {
    // The unique index rejects a slip that already paid for something else.
    const dup = /duplicate key|payment_intents_slip_ref/i.test(settleErr.message);
    return json({ error: dup ? 'สลิปนี้ถูกใช้ไปแล้ว' : settleErr.message,
                  status: dup ? 'slip_reused' : 'error' }, 400);
  }
  return json(settled);
});
