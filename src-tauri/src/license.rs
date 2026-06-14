//! Offline, per-machine licensing with a 7-day trial.
//!
//! A license key is an Ed25519 signature over `"<PREFIX><machine_id>"`. The app embeds
//! only the PUBLIC key and verifies signatures locally — no server required. The matching
//! private seed lives only in the `tools/keygen` utility (kept by the vendor) and is used
//! to mint a key for a customer's machine id.
//!
//! Trial state and the activated key are stored in the Windows registry under
//! `HKCU\Software\Etiquetas`.

use serde::Serialize;

/// Ed25519 public key used to verify license keys. The matching private seed is SECRET
/// and must never ship inside the app (see `tools/keygen/secret.key`).
const LICENSE_PUBLIC_KEY: [u8; 32] = [
    181, 112, 94, 10, 208, 65, 81, 77, 24, 90, 38, 92, 119, 151, 207, 194, 199, 99, 223, 163, 241,
    84, 164, 235, 7, 236, 196, 166, 152, 232, 209, 123,
];

/// Prefix mixed into the signed message; keep in sync with the keygen tool.
const LICENSE_MESSAGE_PREFIX: &str = "etiquetas-license-v1|";

/// Trial length: 7 days.
const TRIAL_SECONDS: i64 = 7 * 24 * 60 * 60;

#[cfg(windows)]
const REG_PATH: &str = "Software\\Etiquetas";
#[cfg(windows)]
const REG_TRIAL_START: &str = "t0";
#[cfg(windows)]
const REG_LICENSE_KEY: &str = "lic";
#[cfg(windows)]
const REG_PASS: &str = "pass"; // signed online license pass
#[cfg(windows)]
const REG_ACTIVATION_CODE: &str = "code"; // activation code (for online re-validation)

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    /// "licensed" | "trial" | "expired"
    pub state: String,
    pub machine_id: String,
    pub trial_days_left: i64,
    /// "lifetime" | "subscription" when licensed; null otherwise.
    pub plan: Option<String>,
    /// Unix seconds when a subscription expires; null for lifetime/trial.
    pub expires_at: Option<i64>,
}

fn status(state: &str, machine: String) -> LicenseStatus {
    LicenseStatus {
        state: state.to_string(),
        machine_id: machine,
        trial_days_left: 0,
        plan: None,
        expires_at: None,
    }
}

fn now_secs() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Stable per-machine identifier shown to the user and bound by the license key.
pub fn machine_id() -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(raw_machine_seed().as_bytes());
    let mut s = String::with_capacity(19);
    for (i, b) in digest.iter().take(8).enumerate() {
        if i > 0 && i % 2 == 0 {
            s.push('-');
        }
        s.push_str(&format!("{:02X}", b));
    }
    s // e.g. "A1B2-C3D4-E5F6-0718"
}

#[cfg(windows)]
fn raw_machine_seed() -> String {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(crypto) = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography") {
        if let Ok(guid) = crypto.get_value::<String, _>("MachineGuid") {
            if !guid.trim().is_empty() {
                return guid;
            }
        }
    }
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown-machine".to_string())
}

#[cfg(not(windows))]
fn raw_machine_seed() -> String {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("HOST"))
        .unwrap_or_else(|_| "dev-machine".to_string())
}

/// Verify a license key against this machine's id.
fn verify_key(machine: &str, key: &str) -> bool {
    use base64::{engine::general_purpose, Engine as _};
    use ed25519_dalek::{Signature, VerifyingKey};

    let cleaned: String = key.chars().filter(|c| !c.is_whitespace()).collect();
    let sig_bytes = match general_purpose::STANDARD.decode(cleaned.as_bytes()) {
        Ok(b) => b,
        Err(_) => return false,
    };
    let sig_arr: [u8; 64] = match sig_bytes.as_slice().try_into() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let vk = match VerifyingKey::from_bytes(&LICENSE_PUBLIC_KEY) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let sig = Signature::from_bytes(&sig_arr);
    let msg = format!("{}{}", LICENSE_MESSAGE_PREFIX, machine);
    vk.verify_strict(msg.as_bytes(), &sig).is_ok()
}

/// A verified online pass: expiry (unix secs, or `i64::MAX` for "never") and plan.
struct PassInfo {
    exp: i64,
    plan: String,
}

/// Verify an online license pass `"<b64url(payloadJSON)>.<b64url(sig)>"` for this machine.
fn verify_pass(machine: &str, token: &str) -> Option<PassInfo> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use ed25519_dalek::{Signature, VerifyingKey};

    let (body, sig_b64) = token.trim().split_once('.')?;
    let sig_bytes = URL_SAFE_NO_PAD.decode(sig_b64).ok()?;
    let sig_arr: [u8; 64] = sig_bytes.as_slice().try_into().ok()?;
    let vk = VerifyingKey::from_bytes(&LICENSE_PUBLIC_KEY).ok()?;
    let sig = Signature::from_bytes(&sig_arr);
    vk.verify_strict(body.as_bytes(), &sig).ok()?;

    let payload = URL_SAFE_NO_PAD.decode(body).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&payload).ok()?;
    if v.get("machine")?.as_str()? != machine {
        return None;
    }
    let exp = match v.get("exp") {
        None | Some(serde_json::Value::Null) => i64::MAX,
        Some(e) => e.as_i64()?,
    };
    let plan = v.get("plan").and_then(|p| p.as_str()).unwrap_or("lifetime").to_string();
    Some(PassInfo { exp, plan })
}

// ---- Persistence (Windows registry) ----

#[cfg(windows)]
fn stored_license() -> Option<String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey(REG_PATH).ok()?;
    key.get_value::<String, _>(REG_LICENSE_KEY).ok()
}

#[cfg(windows)]
fn store_license(key: &str) {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok((reg, _)) = hkcu.create_subkey(REG_PATH) {
        let _ = reg.set_value(REG_LICENSE_KEY, &key.to_string());
    }
}

#[cfg(windows)]
fn stored_pass() -> Option<String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey(REG_PATH).ok()?;
    key.get_value::<String, _>(REG_PASS).ok()
}

#[cfg(windows)]
fn store_pass(pass: &str, activation_code: &str) {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok((reg, _)) = hkcu.create_subkey(REG_PATH) {
        let _ = reg.set_value(REG_PASS, &pass.to_string());
        let _ = reg.set_value(REG_ACTIVATION_CODE, &activation_code.to_string());
    }
}

/// Read the trial start; initialize it to "now" on first run.
#[cfg(windows)]
fn trial_start_or_init() -> i64 {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok((reg, _)) = hkcu.create_subkey(REG_PATH) {
        if let Ok(saved) = reg.get_value::<String, _>(REG_TRIAL_START) {
            if let Ok(v) = saved.trim().parse::<i64>() {
                return v;
            }
        }
        let now = now_secs();
        let _ = reg.set_value(REG_TRIAL_START, &now.to_string());
        return now;
    }
    now_secs()
}

#[cfg(not(windows))]
fn stored_license() -> Option<String> {
    None
}
#[cfg(not(windows))]
fn store_license(_key: &str) {}
#[cfg(not(windows))]
fn stored_pass() -> Option<String> {
    None
}
#[cfg(not(windows))]
fn store_pass(_pass: &str, _activation_code: &str) {}
#[cfg(not(windows))]
fn trial_start_or_init() -> i64 {
    now_secs()
}

// ---- Tauri commands ----

/// Current license state. On non-Windows builds the app is unlocked (dev convenience).
#[tauri::command]
pub fn license_status() -> LicenseStatus {
    let machine = machine_id();

    #[cfg(not(windows))]
    {
        return status("licensed", machine);
    }

    #[cfg(windows)]
    {
        // Online pass (subscription or lifetime issued by the server).
        if let Some(pass) = stored_pass() {
            if let Some(info) = verify_pass(&machine, &pass) {
                if info.exp == i64::MAX || info.exp > now_secs() {
                    return LicenseStatus {
                        plan: Some(info.plan),
                        expires_at: if info.exp == i64::MAX { None } else { Some(info.exp) },
                        ..status("licensed", machine)
                    };
                }
            }
        }

        // Offline key (vendor-minted, perpetual per machine).
        if let Some(key) = stored_license() {
            if verify_key(&machine, &key) {
                return LicenseStatus {
                    plan: Some("lifetime".to_string()),
                    ..status("licensed", machine)
                };
            }
        }

        let start = trial_start_or_init();
        let elapsed = now_secs() - start;
        // elapsed < 0 means the clock was moved back -> treat as tampered/expired.
        if elapsed < 0 || elapsed >= TRIAL_SECONDS {
            status("expired", machine)
        } else {
            let remaining = TRIAL_SECONDS - elapsed;
            LicenseStatus {
                trial_days_left: (remaining + 86_399) / 86_400, // ceil to whole days
                ..status("trial", machine)
            }
        }
    }
}

/// Validate and persist a license key for this machine.
#[tauri::command]
pub fn activate_license(key: String) -> Result<LicenseStatus, String> {
    let machine = machine_id();
    let cleaned: String = key.chars().filter(|c| !c.is_whitespace()).collect();
    if cleaned.is_empty() {
        return Err("Informe a chave de licença.".to_string());
    }
    if verify_key(&machine, &cleaned) {
        store_license(&cleaned);
        Ok(LicenseStatus {
            plan: Some("lifetime".to_string()),
            ..status("licensed", machine)
        })
    } else {
        Err("Chave inválida para este computador.".to_string())
    }
}

/// The activation code stored after a successful online activation (for re-validation).
#[tauri::command]
pub fn stored_activation_code() -> String {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey(REG_PATH) {
            if let Ok(code) = key.get_value::<String, _>(REG_ACTIVATION_CODE) {
                return code;
            }
        }
    }
    String::new()
}

/// Verify and persist an online license pass (issued by the server's `activate`/`validate`).
#[tauri::command]
pub fn apply_license_pass(activation_code: String, pass: String) -> Result<LicenseStatus, String> {
    let machine = machine_id();
    match verify_pass(&machine, &pass) {
        Some(info) if info.exp == i64::MAX || info.exp > now_secs() => {
            store_pass(pass.trim(), activation_code.trim());
            Ok(LicenseStatus {
                plan: Some(info.plan),
                expires_at: if info.exp == i64::MAX { None } else { Some(info.exp) },
                ..status("licensed", machine)
            })
        }
        _ => Err("Passe de licença inválido ou expirado para este computador.".to_string()),
    }
}
