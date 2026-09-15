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
//! - **Nur lokale KI** (Standard): Solange Cloud-KI auf diesem Gerät nicht ausdrücklich erlaubt
//!   ist, geht keine Anfrage an eine Adresse außerhalb dieses Rechners bzw. des lokalen Netzes –
//!   egal, was die Oberfläche schickt. Erlauben geht nur über eine native Rückfrage.
//! - Abbrechen schließt die Verbindung wirklich; ein lokales Modell hört dann auf zu rechnen.

use keyring::Entry;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tokio::sync::oneshot;

const SERVICE: &str = "org.sprechbuch.desktop";
/// Zeitgrenze für Cloud-Anbieter; lokale Modelle dürfen auf langsamen Rechnern beliebig lange rechnen
const CLOUD_TIMEOUT: Duration = Duration::from_secs(900);

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AiError {
    NoKey { message: String },
    Forbidden { message: String },
    Keyring { message: String },
    Network { message: String },
    Aborted { message: String },
    Policy { message: String },
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

/// Dieser Rechner oder lokales Netz? Gleiche Regeln wie `isLocalUrl` in
/// `packages/core/src/llm/providers.ts`: Loopback, private und Link-Local-Adressen (IPv4/IPv6),
/// Rechnernamen ohne Punkt sowie .local, .lan, .home.arpa, .internal und .localhost.
fn is_local_host(url: &Url) -> bool {
    let Some(host) = url.host_str() else { return false };
    let host = host.trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        Ok(IpAddr::V6(ip)) => {
            let first = ip.segments()[0];
            ip.is_loopback() || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
        }
        Err(_) => {
            !host.is_empty()
                && (!host.contains('.')
                    || host == "localhost"
                    || [".localhost", ".local", ".lan", ".home.arpa", ".internal"].iter().any(|s| host.ends_with(s)))
        }
    }
}

/// „Nur lokale KI“ durchsetzen
fn check_policy(url: &Url, allow_cloud: bool) -> Result<(), AiError> {
    if allow_cloud || is_local_host(url) {
        return Ok(());
    }
    Err(AiError::Policy {
        message: format!(
            "Nur lokale KI ist eingeschaltet – {} liegt nicht auf diesem Rechner oder im lokalen Netz.",
            url.host_str().unwrap_or_default()
        ),
    })
}

/// Darf diese Adresse angefragt werden – und passt sie zur Basis-URL des Schlüssels?
fn check_url(url: &str, key_base: Option<&str>) -> Result<Url, AiError> {
    let parsed = Url::parse(url).map_err(|_| AiError::Forbidden { message: format!("Ungültige Adresse: {url}") })?;
    match parsed.scheme() {
        "https" => {}
        "http" if is_local_host(&parsed) => {}
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

/// Darf Buchtext an Cloud-Anbieter gehen? Liegt als Datei im Konfigurationsordner der App –
/// nicht im Web-Speicher der Oberfläche, den ein Fehler dort verändern könnte.
pub struct Policy {
    allow_cloud: Mutex<bool>,
    file: Option<PathBuf>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyStatus {
    allow_cloud: bool,
}

impl Policy {
    pub fn load(dir: Option<PathBuf>) -> Self {
        let file = dir.map(|d| d.join("ai-policy.json"));
        let allow_cloud = file
            .as_ref()
            .and_then(|f| std::fs::read_to_string(f).ok())
            .and_then(|s| serde_json::from_str::<PolicyStatus>(&s).ok())
            .is_some_and(|p| p.allow_cloud);
        Policy { allow_cloud: Mutex::new(allow_cloud), file }
    }

    fn allow_cloud(&self) -> bool {
        *self.allow_cloud.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn set(&self, allow_cloud: bool) -> Result<(), AiError> {
        if let Some(file) = &self.file {
            let io = |e: std::io::Error| AiError::Keyring { message: format!("Einstellung nicht gespeichert: {e}") };
            if let Some(dir) = file.parent() {
                std::fs::create_dir_all(dir).map_err(io)?;
            }
            std::fs::write(file, serde_json::json!({ "allowCloud": allow_cloud }).to_string()).map_err(io)?;
        }
        *self.allow_cloud.lock().unwrap_or_else(|e| e.into_inner()) = allow_cloud;
        Ok(())
    }
}

#[tauri::command]
pub fn ai_policy(policy: State<'_, Policy>) -> PolicyStatus {
    PolicyStatus { allow_cloud: policy.allow_cloud() }
}

/// Cloud-KI erlauben braucht eine native Rückfrage; zurück zu „nur lokal“ geht ohne.
#[tauri::command]
pub async fn ai_policy_set(app: AppHandle, policy: State<'_, Policy>, allow_cloud: bool) -> Result<PolicyStatus, AiError> {
    if allow_cloud && !policy.allow_cloud() {
        let (tx, rx) = oneshot::channel();
        let mut dialog = app
            .dialog()
            .message(
                "Mit Cloud-KI kann Kapiteltext an Anbieter wie Anthropic oder OpenAI gehen – bei jedem Buch erst nach \
                 einer eigenen Einwilligung.\n\nUnveröffentlichte Manuskripte sind oft vertraulich. Cloud-KI auf diesem \
                 Gerät erlauben?",
            )
            .title("Cloud-KI erlauben?")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom("Cloud-KI erlauben".into(), "Nur lokal".into()));
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.parent(&window);
        }
        dialog.show(move |ok| {
            let _ = tx.send(ok);
        });
        if !rx.await.unwrap_or(false) {
            return Ok(PolicyStatus { allow_cloud: false });
        }
    }
    policy.set(allow_cloud)?;
    Ok(PolicyStatus { allow_cloud })
}

/// Laufende Anfragen, damit „Abbrechen“ die Verbindung schließen kann
#[derive(Default)]
pub struct Pending(Mutex<HashMap<String, oneshot::Sender<()>>>);

#[tauri::command]
pub fn ai_http_cancel(pending: State<'_, Pending>, id: String) {
    if let Some(tx) = pending.0.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) {
        let _ = tx.send(());
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiHttpRequest {
    /// zum Abbrechen
    id: Option<String>,
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
            .user_agent(concat!("Sprechbuch/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("HTTP-Client");
        HttpClient(client)
    }
}

#[tauri::command]
pub async fn ai_http(
    client: State<'_, HttpClient>,
    policy: State<'_, Policy>,
    pending: State<'_, Pending>,
    request: AiHttpRequest,
) -> Result<AiHttpResponse, AiError> {
    let parsed = Url::parse(&request.url).map_err(|_| AiError::Forbidden { message: format!("Ungültige Adresse: {}", request.url) })?;
    // Vor dem Schlüssel: Bei „nur lokal“ wird für Cloud-Adressen nicht einmal der Tresor gefragt
    check_policy(&parsed, policy.allow_cloud())?;
    let stored = if request.auth == "none" { None } else { load(&request.provider)? };
    if request.auth != "none" && stored.is_none() {
        return Err(AiError::NoKey { message: "Für diesen Anbieter ist kein Schlüssel gespeichert.".into() });
    }
    let url = check_url(&request.url, stored.as_ref().map(|s| s.base_url.as_str()))?;
    let local = is_local_host(&url);

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
    if !local {
        builder = builder.timeout(CLOUD_TIMEOUT);
    }

    let work = async move {
        let res = builder.send().await.map_err(|e| AiError::Network {
            message: if e.is_timeout() { "Zeitüberschreitung".into() } else { e.to_string() },
        })?;
        let status = res.status().as_u16();
        let retry_after = res.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse::<f64>().ok());
        let body = res.text().await.map_err(|e| AiError::Network { message: e.to_string() })?;
        Ok(AiHttpResponse { status, body, retry_after })
    };

    let Some(id) = request.id else { return work.await };
    let (tx, rx) = oneshot::channel();
    pending.0.lock().unwrap_or_else(|e| e.into_inner()).insert(id.clone(), tx);
    // Abbruch lässt die Anfrage fallen – reqwest schließt dabei die Verbindung
    let result = tokio::select! {
        res = work => res,
        _ = rx => Err(AiError::Aborted { message: "Abgebrochen".into() }),
    };
    pending.0.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
    result
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
    fn lokale_adressen_wie_in_der_oberflaeche() {
        let local = |u: &str| is_local_host(&Url::parse(u).unwrap());
        for url in [
            "http://localhost:11434",
            "http://127.0.0.1:1234/v1",
            "http://[::1]:8080",
            "http://192.168.1.20:11434",
            "http://10.0.0.5",
            "http://172.20.1.1",
            "http://169.254.3.4",
            "http://gpu-box:11434",
            "http://nas.local:11434",
            "https://ki.home.arpa",
            "http://server.lan",
            "http://[fd12:3456::1]:11434",
            "http://[fe80::1]",
        ] {
            assert!(local(url), "{url}");
        }
        for url in [
            "https://api.anthropic.com/v1",
            "http://172.32.0.1",
            "http://8.8.8.8",
            "https://example.com",
            "http://[2001:db8::1]",
            "https://localhost.example.com",
        ] {
            assert!(!local(url), "{url}");
        }
    }

    #[test]
    fn nur_lokale_ki_sperrt_cloud_adressen() {
        let cloud = Url::parse("https://api.anthropic.com/v1/messages").unwrap();
        let ollama = Url::parse("http://localhost:11434/api/chat").unwrap();
        assert!(matches!(check_policy(&cloud, false), Err(AiError::Policy { .. })));
        assert!(check_policy(&cloud, true).is_ok());
        assert!(check_policy(&ollama, false).is_ok());
    }

    #[test]
    fn einstellung_wird_gespeichert_und_standard_ist_lokal() {
        let dir = std::env::temp_dir().join(format!("sprechbuch-policy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let policy = Policy::load(Some(dir.clone()));
        assert!(!policy.allow_cloud());
        policy.set(true).unwrap();
        assert!(Policy::load(Some(dir.clone())).allow_cloud());
        policy.set(false).unwrap();
        assert!(!Policy::load(Some(dir.clone())).allow_cloud());
        std::fs::write(dir.join("ai-policy.json"), "kaputt").unwrap();
        assert!(!Policy::load(Some(dir.clone())).allow_cloud());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn anbieternamen_werden_geprueft() {
        assert!(matches!(entry("../x"), Err(AiError::Forbidden { .. })));
        assert!(matches!(entry(""), Err(AiError::Forbidden { .. })));
    }
}
