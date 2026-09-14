//! KI-Anbindung: Schlüssel im Tresor des Betriebssystems, Anfragen über Rust.
//!
//! - Der Schlüssel liegt im Windows-Anmeldeinformationsspeicher, im macOS-Schlüsselbund bzw.
//!   im Secret Service unter Linux. Er verlässt diesen Prozess nie Richtung Oberfläche – die
//!   Oberfläche erfährt nur, ob einer da ist (und die letzten vier Zeichen zur Wiedererkennung).
//! - Die Oberfläche schickt Anfragen *ohne* Schlüssel; erst hier wird der Header gesetzt. Das
//!   umgeht nebenbei CORS, auch bei lokalen Servern wie Ollama.
//! - Ein Schlüssel ist an die Basis-URL gebunden, für die er gespeichert wurde. Selbst eine
//!   manipulierte Oberfläche könnte ihn nicht an eine andere Adresse schicken.
//! - Unverschlüsseltes HTTP nur zu diesem Rechner oder ins lokale Netz.

use keyring::Entry;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::IpAddr;
use std::time::Duration;
use tauri::State;

const SERVICE: &str = "org.sprechbuch.desktop";

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AiError {
    NoKey { message: String },
    Forbidden { message: String },
    Keyring { message: String },
    Network { message: String },
}

impl From<keyring::Error> for AiError {
    fn from(err: keyring::Error) -> Self {
        AiError::Keyring { message: format!("Schlüsselspeicher: {err}") }
    }
}

#[derive(Serialize, Deserialize)]
struct StoredKey {
    base_url: String,
    key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    base_url: String,
    /// letzte vier Zeichen, zur Wiedererkennung
    hint: String,
}

fn entry(provider: &str) -> Result<Entry, AiError> {
    if provider.is_empty() || provider.len() > 64 || !provider.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(AiError::Forbidden { message: format!("Ungültiger Anbietername: {provider}") });
    }
    Ok(Entry::new(SERVICE, &format!("ai:{provider}"))?)
}

fn load(provider: &str) -> Result<Option<StoredKey>, AiError> {
    match entry(provider)?.get_password() {
        Ok(raw) => Ok(serde_json::from_str(&raw).ok()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.into()),
    }
}

fn normalize_base(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

fn is_private_host(url: &Url) -> bool {
    match url.host_str() {
        None => false,
        Some("localhost") => true,
        Some(host) => match host.trim_start_matches('[').trim_end_matches(']').parse::<IpAddr>() {
            Ok(IpAddr::V4(ip)) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
            Ok(IpAddr::V6(ip)) => ip.is_loopback(),
            Err(_) => host.ends_with(".local"),
        },
    }
}

/// Darf diese Adresse angefragt werden – und passt sie zur Basis-URL des Schlüssels?
fn check_url(url: &str, key_base: Option<&str>) -> Result<Url, AiError> {
    let parsed = Url::parse(url).map_err(|_| AiError::Forbidden { message: format!("Ungültige Adresse: {url}") })?;
    match parsed.scheme() {
        "https" => {}
        "http" if is_private_host(&parsed) => {}
        "http" => return Err(AiError::Forbidden { message: "Unverschlüsseltes HTTP nur zu diesem Rechner oder ins lokale Netz.".into() }),
        other => return Err(AiError::Forbidden { message: format!("Nicht erlaubtes Protokoll: {other}") }),
    }
    if let Some(base) = key_base {
        let base = normalize_base(base);
        let rest = url.strip_prefix(&base);
        if !matches!(rest, Some(r) if r.is_empty() || r.starts_with('/') || r.starts_with('?')) {
            return Err(AiError::Forbidden { message: format!("Der Schlüssel gilt nur für {base}.") });
        }
    }
    Ok(parsed)
}

#[tauri::command]
pub async fn ai_key_status(provider: String) -> Result<Option<KeyStatus>, AiError> {
    Ok(load(&provider)?.map(|k| KeyStatus {
        hint: k.key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect(),
        base_url: k.base_url,
    }))
}

#[tauri::command]
pub async fn ai_key_set(provider: String, base_url: String, key: String) -> Result<(), AiError> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err(AiError::NoKey { message: "Kein Schlüssel angegeben.".into() });
    }
    check_url(&normalize_base(&base_url), None)?;
    let stored = serde_json::to_string(&StoredKey { base_url: normalize_base(&base_url), key })
        .map_err(|e| AiError::Keyring { message: e.to_string() })?;
    entry(&provider)?.set_password(&stored)?;
    Ok(())
}

#[tauri::command]
pub async fn ai_key_delete(provider: String) -> Result<(), AiError> {
    match entry(&provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.into()),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiHttpRequest {
    provider: String,
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    /// "x-api-key" | "bearer" | "none"
    auth: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiHttpResponse {
    status: u16,
    body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after: Option<f64>,
}

pub struct HttpClient(pub reqwest::Client);

impl HttpClient {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            // Lange Kapitel brauchen ihre Zeit
            .timeout(Duration::from_secs(900))
            .user_agent(concat!("Sprechbuch/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("HTTP-Client");
        HttpClient(client)
    }
}

#[tauri::command]
pub async fn ai_http(client: State<'_, HttpClient>, request: AiHttpRequest) -> Result<AiHttpResponse, AiError> {
    let stored = if request.auth == "none" { None } else { load(&request.provider)? };
    if request.auth != "none" && stored.is_none() {
        return Err(AiError::NoKey { message: "Für diesen Anbieter ist kein Schlüssel gespeichert.".into() });
    }
    let url = check_url(&request.url, stored.as_ref().map(|s| s.base_url.as_str()))?;

    let mut builder = match request.method.as_str() {
        "GET" => client.0.get(url),
        "POST" => client.0.post(url),
        other => return Err(AiError::Forbidden { message: format!("Nicht erlaubte Methode: {other}") }),
    };
    for (name, value) in &request.headers {
        // Zugangsdaten setzt ausschließlich dieser Prozess
        if matches!(name.to_ascii_lowercase().as_str(), "authorization" | "x-api-key" | "cookie" | "host") {
            continue;
        }
        builder = builder.header(name, value);
    }
    if let Some(stored) = &stored {
        builder = match request.auth.as_str() {
            "x-api-key" => builder.header("x-api-key", &stored.key),
            "bearer" => builder.bearer_auth(&stored.key),
            other => return Err(AiError::Forbidden { message: format!("Unbekannte Anmeldeart: {other}") }),
        };
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let res = builder.send().await.map_err(|e| AiError::Network {
        message: if e.is_timeout() { "Zeitüberschreitung".into() } else { e.to_string() },
    })?;
    let status = res.status().as_u16();
    let retry_after = res.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse::<f64>().ok());
    let body = res.text().await.map_err(|e| AiError::Network { message: e.to_string() })?;
    Ok(AiHttpResponse { status, body, retry_after })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nur_https_oder_lokales_http() {
        assert!(check_url("https://api.anthropic.com/v1/messages", None).is_ok());
        assert!(check_url("http://localhost:11434/v1/chat/completions", None).is_ok());
        assert!(check_url("http://127.0.0.1:1234/v1/models", None).is_ok());
        assert!(check_url("http://192.168.1.20:11434/v1/models", None).is_ok());
        assert!(check_url("http://[::1]:8080/v1", None).is_ok());
        assert!(check_url("http://example.com/v1", None).is_err());
        assert!(check_url("file:///etc/passwd", None).is_err());
        assert!(check_url("kein url", None).is_err());
    }

    #[test]
    fn schluessel_nur_fuer_seine_basis_url() {
        let base = Some("https://api.anthropic.com/v1/");
        assert!(check_url("https://api.anthropic.com/v1/messages", base).is_ok());
        assert!(check_url("https://api.anthropic.com/v1", base).is_ok());
        assert!(check_url("https://api.anthropic.com/v10/messages", base).is_err());
        assert!(check_url("https://api.anthropic.com.evil.example/v1/messages", base).is_err());
        assert!(check_url("https://evil.example/v1/messages", base).is_err());
    }

    #[test]
    fn anbieternamen_werden_geprueft() {
        assert!(matches!(entry("../x"), Err(AiError::Forbidden { .. })));
        assert!(matches!(entry(""), Err(AiError::Forbidden { .. })));
    }
}
