// POST { activationCode, machineId } -> { pass } | { status } | { error }
// Periodic re-check used by the app to refresh a subscription pass or detect revocation.

import { adminClient, corsHeaders, json, signPass, type LicensePassPayload } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  let body: { activationCode?: string; machineId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo inválido." }, 400);
  }
  const code = (body.activationCode ?? "").trim().toUpperCase();
  const machine = (body.machineId ?? "").trim();
  if (!code || !machine) return json({ error: "Dados incompletos." }, 400);

  const db = adminClient();
  const { data: license } = await db
    .from("licenses")
    .select("*")
    .eq("activation_code", code)
    .maybeSingle();

  if (!license) return json({ status: "revoked" });

  const { data: activation } = await db
    .from("activations")
    .select("id")
    .eq("license_id", license.id)
    .eq("machine_id", machine)
    .maybeSingle();
  if (!activation) return json({ status: "revoked" });

  const expired = license.expires_at && new Date(license.expires_at).getTime() < Date.now();
  if (license.status !== "active" || expired) {
    return json({ status: expired ? "expired" : license.status });
  }

  const payload: LicensePassPayload = {
    v: 1,
    lic: license.id,
    machine,
    plan: license.plan,
    exp: license.expires_at ? Math.floor(new Date(license.expires_at).getTime() / 1000) : null,
    iat: Math.floor(Date.now() / 1000),
  };
  return json({ status: "active", pass: await signPass(payload) });
});
