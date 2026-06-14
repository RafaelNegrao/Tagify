// POST { activationCode, machineId } -> { pass } | { error }
// Binds the machine to the license (respecting max_activations) and returns a signed pass.

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
  if (!code || !machine) return json({ error: "Informe a chave e o ID do computador." }, 400);

  const db = adminClient();
  const { data: license } = await db
    .from("licenses")
    .select("*")
    .eq("activation_code", code)
    .maybeSingle();

  if (!license) return json({ error: "Chave de licença não encontrada." }, 404);
  if (license.status !== "active") {
    return json({ error: "Esta licença não está ativa." }, 403);
  }
  if (license.expires_at && new Date(license.expires_at).getTime() < Date.now()) {
    return json({ error: "Esta licença expirou." }, 403);
  }

  // Already activated on this machine? Otherwise enforce the activation limit.
  const { data: existing } = await db
    .from("activations")
    .select("id")
    .eq("license_id", license.id)
    .eq("machine_id", machine)
    .maybeSingle();

  if (!existing) {
    const { count } = await db
      .from("activations")
      .select("id", { count: "exact", head: true })
      .eq("license_id", license.id);
    if ((count ?? 0) >= license.max_activations) {
      return json({ error: "Limite de ativações atingido para esta licença." }, 403);
    }
    const { error: insErr } = await db
      .from("activations")
      .insert({ license_id: license.id, machine_id: machine });
    if (insErr) return json({ error: "Falha ao registrar ativação." }, 500);
  }

  const payload: LicensePassPayload = {
    v: 1,
    lic: license.id,
    machine,
    plan: license.plan,
    exp: license.expires_at ? Math.floor(new Date(license.expires_at).getTime() / 1000) : null,
    iat: Math.floor(Date.now() / 1000),
  };
  return json({ pass: await signPass(payload) });
});
