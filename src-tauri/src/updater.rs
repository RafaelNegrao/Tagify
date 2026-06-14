//! Auto-update via GitHub Releases (portable .exe model).
//!
//! Flow:
//!   1. `check_update` reads the latest release; if its version is newer, returns the
//!      download URL of the release's `.exe` asset.
//!   2. `run_update` downloads it next to the running exe as `Tagify-<version>.exe`,
//!      then a hidden cmd closes this app, deletes the old exe and launches the new one.

use serde::Serialize;

// === GitHub repository (owner/name) ===
const GITHUB_OWNER: &str = "RafaelNegrao";
const GITHUB_REPO: &str = "Tagify";

const USER_AGENT: &str = "Tagify-Updater";
const GITHUB_BASE: &str = "https://github.com";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub current: String,
    pub version: String,
    pub url: String,
}

fn parse_ver(v: &str) -> Vec<u32> {
    v.trim().trim_start_matches('v')
        .split('.')
        .map(|p| {
            p.chars()
                .take_while(|c| c.is_ascii_digit())
                .collect::<String>()
                .parse()
                .unwrap_or(0)
        })
        .collect()
}

fn is_newer(latest: &str, current: &str) -> bool {
    let a = parse_ver(latest);
    let b = parse_ver(current);
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    false
}

fn update_info(current: String, version: String, url: String) -> UpdateInfo {
    UpdateInfo {
        available: !version.is_empty() && !url.is_empty() && is_newer(&version, &current),
        current,
        version,
        url,
    }
}

fn check_update_api() -> Result<(String, String), String> {
    let api = format!(
        "https://api.github.com/repos/{}/{}/releases/latest",
        GITHUB_OWNER, GITHUB_REPO
    );

    let body = ureq::get(&api)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json")
        .set("X-GitHub-Api-Version", "2022-11-28")
        .call()
        .map_err(|e| format!("GitHub API: {e}"))?
        .into_string()
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;

    let version = json["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();
    let url = json["assets"]
        .as_array()
        .and_then(|assets| {
            assets.iter().find(|a| {
                a["name"]
                    .as_str()
                    .map(|n| n.to_lowercase().ends_with(".exe"))
                    .unwrap_or(false)
            })
        })
        .and_then(|a| a["browser_download_url"].as_str())
        .unwrap_or("")
        .to_string();

    if version.is_empty() || url.is_empty() {
        return Err("release sem asset .exe".to_string());
    }

    Ok((version, url))
}

fn check_update_public_page() -> Result<(String, String), String> {
    let latest = format!(
        "{}/{}/{}/releases/latest",
        GITHUB_BASE, GITHUB_OWNER, GITHUB_REPO
    );

    let resp = ureq::get(&latest)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "text/html")
        .call()
        .map_err(|e| format!("pagina publica: {e}"))?;

    let final_url = resp.get_url().to_string();
    let latest_body = resp.into_string().map_err(|e| e.to_string())?;
    let tag = tag_from_release_url(&final_url)
        .or_else(|| tag_from_release_html(&latest_body))
        .ok_or_else(|| "nao foi possivel identificar a versao mais recente".to_string())?;

    let assets_url = format!(
        "{}/{}/{}/releases/expanded_assets/{}",
        GITHUB_BASE, GITHUB_OWNER, GITHUB_REPO, tag
    );
    let assets_body = match ureq::get(&assets_url)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "text/html")
        .call()
    {
        Ok(resp) => resp.into_string().unwrap_or_default(),
        Err(_) => String::new(),
    };

    let url = find_exe_asset_url(&assets_body)
        .or_else(|| find_exe_asset_url(&latest_body))
        .ok_or_else(|| "nao foi encontrado asset .exe na release mais recente".to_string())?;

    Ok((tag.trim_start_matches('v').to_string(), url))
}

fn tag_from_release_url(url: &str) -> Option<String> {
    url.split("/releases/tag/")
        .nth(1)
        .and_then(|tag| tag.split(['?', '#']).next())
        .filter(|tag| !tag.trim().is_empty())
        .map(|tag| tag.trim().to_string())
}

fn tag_from_release_html(html: &str) -> Option<String> {
    let marker = "/releases/tag/";
    let start = html.find(marker)? + marker.len();
    let tag = html[start..]
        .split(['"', '\'', '<', '>', '?', '#'])
        .next()
        .unwrap_or("")
        .trim();
    (!tag.is_empty()).then(|| tag.to_string())
}

fn find_exe_asset_url(html: &str) -> Option<String> {
    let mut rest = html;
    while let Some(pos) = rest.find("href=\"") {
        rest = &rest[pos + 6..];
        let Some(end) = rest.find('"') else { break };
        let href = html_unescape_attr(&rest[..end]);
        let lower = href.to_lowercase();
        if lower.contains("/releases/download/") && lower.ends_with(".exe") {
            return Some(if href.starts_with("https://") {
                href
            } else {
                format!("{GITHUB_BASE}{href}")
            });
        }
        rest = &rest[end + 1..];
    }
    None
}

fn html_unescape_attr(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&#x2F;", "/")
        .replace("&#47;", "/")
}

/// Check the latest GitHub release for a newer version.
/// `current` is the app version from `package.json` (the source of truth).
#[tauri::command]
pub fn check_update(current: String) -> Result<UpdateInfo, String> {
    match check_update_api().or_else(|_| check_update_public_page()) {
        Ok((version, url)) => Ok(update_info(current, version, url)),
        Err(err) => Err(format!("Falha ao consultar atualizacoes: {err}")),
    }
}

/// Download the new exe next to the current one and relaunch it.
#[tauri::command]
pub fn run_update(version: String, url: String) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe
        .parent()
        .ok_or_else(|| "Não foi possível localizar a pasta do app.".to_string())?
        .to_path_buf();
    let dest = dir.join(format!("Tagify-{}.exe", version));

    // Download.
    let resp = ureq::get(&url)
        .set("User-Agent", USER_AGENT)
        .call()
        .map_err(|e| format!("Falha ao baixar: {e}"))?;
    let mut reader = resp.into_reader();
    let mut file = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
    std::io::copy(&mut reader, &mut file).map_err(|e| e.to_string())?;
    drop(file);

    relaunch(&dir, &exe, &dest)?;
    Ok(())
}

/// Write a hidden helper script that waits for this app to close, deletes old exes,
/// starts the new exe, then deletes itself. Spawn it (hidden) and exit.
#[cfg(windows)]
fn relaunch(
    dir: &std::path::Path,
    current_exe: &std::path::Path,
    dest: &std::path::Path,
) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let script_path = dir.join("tagify-update.ps1");
    let current_pid = std::process::id();
    let script = format!(
        "$ErrorActionPreference = 'SilentlyContinue'\r\n\
         $oldExe = '{}'\r\n\
         $newExe = '{}'\r\n\
         $appDir = '{}'\r\n\
         $oldPid = {}\r\n\
         Wait-Process -Id $oldPid -Timeout 60\r\n\
         Start-Sleep -Milliseconds 500\r\n\
         if ($oldExe -ne $newExe) {{\r\n\
         for ($i = 0; $i -lt 30 -and (Test-Path -LiteralPath $oldExe); $i++) {{\r\n\
         Remove-Item -LiteralPath $oldExe -Force\r\n\
         Start-Sleep -Seconds 1\r\n\
         }}\r\n\
         }}\r\n\
         Get-ChildItem -LiteralPath $appDir -Filter 'Tagify-*.exe' | Where-Object {{ $_.FullName -ne $newExe }} | Remove-Item -Force\r\n\
         Start-Process -FilePath $newExe -WorkingDirectory $appDir\r\n\
         Remove-Item -LiteralPath $PSCommandPath -Force\r\n",
        ps_quote(current_exe),
        ps_quote(dest),
        ps_quote(dir),
        current_pid
    );
    std::fs::write(&script_path, script).map_err(|e| e.to_string())?;

    Command::new("powershell")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-File",
        ])
        .arg(&script_path)
        .spawn()
        .map_err(|e| e.to_string())?;

    std::process::exit(0);
}

#[cfg(windows)]
fn ps_quote(path: &std::path::Path) -> String {
    path.display().to_string().replace('\'', "''")
}

#[cfg(not(windows))]
fn relaunch(
    _dir: &std::path::Path,
    current_exe: &std::path::Path,
    dest: &std::path::Path,
) -> Result<(), String> {
    use std::process::Command;
    Command::new(dest).spawn().map_err(|e| e.to_string())?;
    if current_exe != dest {
        let _ = std::fs::remove_file(current_exe);
    }
    std::process::exit(0);
}
