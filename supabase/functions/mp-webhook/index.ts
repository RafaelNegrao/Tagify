// Mercado Pago notifications -> create/update licenses.
//
// Handles approved one-time payments (plan 'lifetime') and subscription/preapproval events
// (plan 'subscription'). Mercado Pago only sends an id + type; we fetch the full resource
// from the MP API with MP_ACCESS_TOKEN to learn the real status (never trust the webhook body).
//
// NOTE: finalize this against YOUR Mercado Pago account — payload shapes and the exact
// subscription period come from your product config. Marked TODOs below.

import { adminClient, json, newActivationCode } from "../_shared/util.ts";

const MP_TOKEN = Deno.env.get("MP_ACCESS_TOKEN") ?? "";

async function mpGet(path: string) {
  const res = await fetch(`https://api.mercadopago.com${path}`, {
    headers: { Authorization: `Bearer ${MP_TOKEN}` },
  });
  if (!res.ok) throw new Error(`MP API ${path} -> ${res.status}`);
  return res.json();
}

/** Create the license if this provider_ref is new; return its activation code either way. */
async function upsertLicense(opts: {
  email: string;
  plan: "lifetime" | "subscription";
  providerRef: string;
  status: string;
  expiresAt: string | null;
}) {
  const db = adminClient();
  const { data: existing } = await db
    .from("licenses")
    .select("id, activation_code")
    .eq("provider_ref", opts.providerRef)
    .maybeSingle();

  if (existing) {
    await db
      .from("licenses")
      .update({ status: opts.status, expires_at: opts.expiresAt, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    return existing.activation_code as string;
  }

  const code = newActivationCode();
  await db.from("licenses").insert({
    email: opts.email,
    plan: opts.plan,
    status: opts.status,
    provider: "mercadopago",
    provider_ref: opts.providerRef,
    activation_code: code,
    expires_at: opts.expiresAt,
  });
  // TODO: deliver `code` to opts.email (e.g. Resend) or show it on the MP success page.
  console.log(`Licença criada para ${opts.email}: ${code}`);
  return code;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  // TODO (recomendado): validar x-signature/x-request-id com MP_WEBHOOK_SECRET antes de processar.
  let body: { type?: string; topic?: string; data?: { id?: string }; id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("ok"); // MP also pings with query params; ack to stop retries.
  }

  const type = body.type ?? body.topic ?? "";
  const id = body.data?.id ?? body.id;
  if (!id) return new Response("ok");

  try {
    if (type.includes("payment")) {
      const payment = await mpGet(`/v1/payments/${id}`);
      if (payment.status === "approved") {
        await upsertLicense({
          email: payment.payer?.email ?? "desconhecido",
          plan: "lifetime",
          providerRef: String(payment.id),
          status: "active",
          expiresAt: null,
        });
      }
    } else if (type.includes("subscription") || type.includes("preapproval")) {
      const pre = await mpGet(`/preapproval/${id}`);
      const active = pre.status === "authorized";
      // TODO: derive the real period end from `pre`. Default: 31 days from now while active.
      const expiresAt = active
        ? new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString()
        : null;
      await upsertLicense({
        email: pre.payer_email ?? "desconhecido",
        plan: "subscription",
        providerRef: String(pre.id),
        status: active ? "active" : "canceled",
        expiresAt,
      });
    }
  } catch (err) {
    console.error("Webhook MP falhou:", err);
    return json({ error: "erro ao processar" }, 500); // MP will retry
  }

  return new Response("ok");
});
