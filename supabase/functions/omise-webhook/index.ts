// Omise webhook → extend pro_until.
//
// verify_jwt is off because Omise calls this, not a signed-in browser. Omise
// does not sign its webhooks, so the payload is treated as a hint only: the
// charge id is re-fetched from the Omise API with the secret key, and every
// decision is made from that response. A forged POST therefore buys nothing.
//
// Replays are harmless — billing_events.charge_id is unique, and the insert is
// what gates the pro_until update.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const OMISE_API = "https://api.omise.co";

// Omise retries anything that is not 2xx, so acknowledge everything we have
// decided not to act on.
const ack = (why: string) => new Response(why, { status: 200 });

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  let event: { key?: string; data?: { id?: string; object?: string } };
  try {
    event = await req.json();
  } catch {
    return new Response("bad payload", { status: 400 });
  }

  const chargeId = event?.data?.object === "charge" ? event.data.id : undefined;
  if (!chargeId) return ack("not a charge event");

  const secret = Deno.env.get("OMISE_SECRET_KEY");
  if (!secret) {
    // Retrying will not help until somebody sets the key, but losing the event
    // silently would be worse, so make it loud and let Omise retry.
    console.error("OMISE_SECRET_KEY is not set; cannot verify", chargeId);
    return new Response("not configured", { status: 503 });
  }

  // Never trust the body: ask Omise what this charge really is.
  const res = await fetch(`${OMISE_API}/charges/${chargeId}`, {
    headers: { Authorization: "Basic " + btoa(secret + ":") },
  });
  const charge = await res.json();

  if (!res.ok || charge.object !== "charge") {
    console.error("could not re-fetch charge", chargeId, charge);
    return ack("unknown charge");
  }

  if (charge.status !== "successful" || charge.paid !== true) {
    console.log("charge not payable yet", chargeId, charge.status);
    return ack("not paid");
  }

  const userId = charge.metadata?.user_id as string | undefined;
  const months = Number(charge.metadata?.months ?? 1);
  if (!userId || !Number.isFinite(months) || months < 1) {
    console.error("charge is missing usable metadata", chargeId, charge.metadata);
    return ack("no metadata");
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Claim this charge. A duplicate key means a replay we have already applied.
  const { error: claimError } = await admin.from("billing_events").insert({
    user_id: userId,
    provider: "omise",
    charge_id: charge.id,
    status: charge.status,
    amount_satang: charge.amount,
    currency: charge.currency?.toUpperCase() ?? "THB",
    months,
    method: charge.source?.type ?? charge.card?.brand ?? "card",
    raw: charge,
  });

  if (claimError) {
    if (claimError.code === "23505") return ack("already applied");
    console.error("could not record charge", claimError);
    return new Response("ledger write failed", { status: 500 });
  }

  const { data: proUntil, error: extendError } = await admin
    .rpc("extend_pro", { p_user: userId, p_months: months });

  if (extendError) {
    console.error("could not extend pro_until", extendError);
    return new Response("grant failed", { status: 500 });
  }

  await admin.from("billing_events")
    .update({ pro_until_after: proUntil })
    .eq("charge_id", charge.id);

  console.log("pro extended", userId, months, proUntil);
  return ack("ok");
});
