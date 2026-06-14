import { invoke } from "@tauri-apps/api/core";
import { SUPABASE_ANON_KEY, SUPABASE_FUNCTIONS_URL, onlineLicensingEnabled } from "./licenseConfig";

export type LicenseState = "licensed" | "trial" | "expired";

export interface LicenseStatus {
  state: LicenseState;
  machineId: string;
  trialDaysLeft: number;
  plan?: string | null; // "lifetime" | "subscription"
  expiresAt?: number | null; // unix seconds (subscription)
}

export async function getStoredActivationCode(): Promise<string> {
  try {
    return await invoke<string>("stored_activation_code");
  } catch {
    return "";
  }
}

export async function fetchLicenseStatus(): Promise<LicenseStatus> {
  return invoke<LicenseStatus>("license_status");
}

/** Offline activation: verify a vendor-minted key bound to this machine. */
export async function activateLicense(key: string): Promise<LicenseStatus> {
  return invoke<LicenseStatus>("activate_license", { key });
}

/** Apply a signed pass (carries plan + expiry), e.g. a timed test key. */
export async function applyPass(pass: string): Promise<LicenseStatus> {
  return invoke<LicenseStatus>("apply_license_pass", { activationCode: "", pass });
}

async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || "Falha de comunicação com o servidor.");
  return data as T;
}

/** Online activation: exchange an activation code for a signed pass, then store it. */
export async function activateOnline(activationCode: string, machineId: string): Promise<LicenseStatus> {
  const { pass } = await callFunction<{ pass: string }>("activate", { activationCode, machineId });
  return invoke<LicenseStatus>("apply_license_pass", { activationCode, pass });
}

/**
 * Best-effort re-validation of the stored online license on startup. Refreshes the cached
 * pass (extends a subscription) when the server confirms it's active. Silently ignored when
 * offline or not configured, so the cached pass keeps the app usable without internet.
 */
export async function revalidateStored(machineId: string): Promise<void> {
  if (!onlineLicensingEnabled()) return;
  let activationCode = "";
  try {
    activationCode = await invoke<string>("stored_activation_code");
  } catch {
    return;
  }
  if (!activationCode) return;
  try {
    const data = await callFunction<{ status: string; pass?: string }>("validate", {
      activationCode,
      machineId,
    });
    if (data.status === "active" && data.pass) {
      await invoke("apply_license_pass", { activationCode, pass: data.pass });
    }
    // If revoked/expired we keep the cached pass; license_status enforces its expiry.
  } catch {
    // Offline or server unreachable — stay on the cached pass.
  }
}
