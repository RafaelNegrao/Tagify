// Shared helpers for the license Edge Functions.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Service-role client (bypasses RLS) — only ever used server-side in functions. */
export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Ed25519 PKCS8 wrapper for a raw 32-byte seed.
const PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

let keyPromise: Promise<CryptoKey> | null = null;
function signingKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    const seed = hexToBytes(Deno.env.get("LICENSE_SIGNING_SEED")!);
    if (seed.length !== 32) throw new Error("LICENSE_SIGNING_SEED must be 32 bytes (64 hex chars)");
    const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + 32);
    pkcs8.set(PKCS8_PREFIX, 0);
    pkcs8.set(seed, PKCS8_PREFIX.length);
    keyPromise = crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
  }
  return keyPromise;
}

export interface LicensePassPayload {
  v: 1;
  lic: string; // license id
  machine: string; // machine id this pass is bound to
  plan: string; // 'lifetime' | 'subscription'
  exp: number | null; // unix seconds, null = never
  iat: number; // issued-at unix seconds
}

/**
 * A license "pass" = base64url(payloadJSON) + "." + base64url(ed25519 signature over the
 * payload string). The app verifies the signature with its embedded public key, then reads
 * the fields (machine binding + expiry) and caches it for offline use.
 */
export async function signPass(payload: LicensePassPayload): Promise<string> {
  const enc = new TextEncoder();
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("Ed25519", await signingKey(), enc.encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

/** Customer-facing activation code, e.g. ETQ-9F3A-1C7B-D204. */
export function newActivationCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
  return `ETQ-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}
