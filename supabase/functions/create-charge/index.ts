// Start an Omise charge for a Pro plan.
//
// The price is read from billing_plans here, never taken from the request, so
// the browser cannot name its own amount. Nothing is granted at this point —
// only the webhook, which re-fetches the charge from Omise, extends pro_until.
//
// Secrets (set these in Supabase → Edge Functions → Secrets, not in code):
//   OMISE_SECRET_KEY   skey_test_... / skey_live_...
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const OMISE_API = "https://api.omise.co";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // Identify the caller first: who you are should not depend on whether the
  // owner has finished wiring up payments.
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return json({ error: "ต้องเข้าสู่ระบบก่อน" }, 401);

  const secret = Deno.env.get("OMISE_SECRET_KEY");
  if (!secret) return json({ error: "ระบบยังไม่ได้ตั้งค่าการชำระเงิน" }, 503);

  let body: { plan?: string; method?: string; token?: string; return_uri?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad request body" }, 400);
  }

  const method = body.method === "promptpay" ? "promptpay" : "card";
  if (method === "card" && !body.token) {
    return json({ error: "ไม่มี card token" }, 400);
  }

  // price comes from the database, not the caller
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: plan } = await admin
    .from("billing_plans")
    .select("code, months, amount_satang, label_th")
    .eq("code", body.plan ?? "")
    .eq("active", true)
    .maybeSingle();

  if (!plan) return json({ error: "ไม่พบแพ็กเกจนี้" }, 400);

  const form = new URLSearchParams();
  form.set("amount", String(plan.amount_satang));
  form.set("currency", "THB");
  form.set("description", `${plan.label_th} — ${user.id}`);
  form.set("metadata[user_id]", user.id);
  form.set("metadata[plan]", plan.code);
  form.set("metadata[months]", String(plan.months));

  if (method === "card") {
    form.set("card", body.token!);
    if (body.return_uri) form.set("return_uri", body.return_uri);
  } else {
    // PromptPay is one-time only; Omise cannot auto-renew it. Each successful
    // charge simply pushes pro_until further out, so that is fine here.
    form.set("source[type]", "promptpay");
    if (body.return_uri) form.set("return_uri", body.return_uri);
  }

  const res = await fetch(`${OMISE_API}/charges`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(secret + ":"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });

  const charge = await res.json();
  if (!res.ok || charge.object === "error") {
    console.error("omise charge failed", charge);
    return json({ error: charge.message ?? "สร้างรายการชำระเงินไม่สำเร็จ" }, 400);
  }

  return json({
    ok: true,
    charge_id: charge.id,
    status: charge.status,
    paid: charge.paid === true,
    // card 3-D Secure sends the user here; PromptPay returns a QR to scan
    authorize_uri: charge.authorize_uri ?? null,
    qr_image: charge.source?.scannable_code?.image?.download_uri ?? null,
    expires_at: charge.expires_at ?? null,
    amount_satang: plan.amount_satang,
    months: plan.months,
  });
});
