//! Buchdateien lesen und sicher schreiben.
//!
//! - **Atomar:** Es wird in eine temporäre Datei im selben Ordner geschrieben, auf die Platte
//!   gebracht (`sync_all`) und dann über die alte Datei umbenannt. Ein Absturz oder voller
//!   Datenträger hinterlässt nie eine halbe `.hbook`-Datei.
//! - **Fremde Änderungen:** Jede Datei hat einen Stempel (Größe, Änderungszeit, SHA-256).
//!   Beim Speichern wird der zuletzt bekannte Hash mitgeschickt; stimmt er nicht mehr (z. B.
//!   weil ein Cloud-Dienst eine Fassung von einem anderen Gerät eingespielt hat), wird nicht
//!   überschrieben, sondern ein Konflikt gemeldet.
//! - **Eng begrenzt:** Nur absolute Pfade, lesen nur Buch- und Quelldateien, schreiben nur `.hbook`.
//!   Alles andere läuft weiter über die Dateidialoge und deren Rechte.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

const READABLE: &[&str] = &["hbook", "epub", "pdf", "json"];
const WRITABLE: &[&str] = &["hbook"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStamp {
    pub size: u64,
    pub modified_ms: u64,
    /// Nur gesetzt, wenn der Inhalt gelesen wurde
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileError {
    NotFound { message: String },
    Conflict { current: FileStamp },
    Forbidden { message: String },
    Io { message: String },
}

impl From<io::Error> for FileError {
    fn from(err: io::Error) -> Self {
        match err.kind() {
            io::ErrorKind::NotFound => FileError::NotFound { message: err.to_string() },
            io::ErrorKind::PermissionDenied => FileError::Forbidden { message: err.to_string() },
            _ => FileError::Io { message: err.to_string() },
        }
    }
}

fn has_extension(path: &Path, allowed: &[&str]) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| allowed.iter().any(|a| a.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

fn checked(path: &str, allowed: &[&str]) -> Result<PathBuf, FileError> {
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err(FileError::Forbidden { message: format!("Kein absoluter Pfad: {path}") });
    }
    if !has_extension(&p, allowed) {
        return Err(FileError::Forbidden { message: format!("Dateityp nicht erlaubt: {path}") });
    }
    Ok(p)
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn quick_stamp(meta: &fs::Metadata) -> FileStamp {
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    FileStamp { size: meta.len(), modified_ms, sha256: None }
}

/// Inhalt und dazu passenden Stempel lesen – ändert sich die Datei währenddessen, erneut versuchen.
fn read_consistent(path: &Path) -> io::Result<(Vec<u8>, FileStamp)> {
    let mut attempt = 0;
    loop {
        let before = quick_stamp(&fs::metadata(path)?);
        let bytes = fs::read(path)?;
        let after = quick_stamp(&fs::metadata(path)?);
        if before == after || attempt >= 3 {
            let stamp = FileStamp { sha256: Some(sha256_hex(&bytes)), ..after };
            return Ok((bytes, stamp));
        }
        attempt += 1;
        thread::sleep(Duration::from_millis(150));
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or_else(|| Path::new("."));
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
    let tmp = dir.join(format!(".{name}.{}-{nanos}.tmp", std::process::id()));

    let result = (|| {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        // Unter Windows halten Virenscanner oder Sync-Clients die Zieldatei manchmal kurz offen
        let mut last = None;
        for attempt in 1..=6u64 {
            match fs::rename(&tmp, path) {
                Ok(()) => return Ok(()),
                Err(err) => {
                    last = Some(err);
                    thread::sleep(Duration::from_millis(80 * attempt));
                }
            }
        }
        Err(last.expect("mindestens ein Versuch"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Datei lesen. Antwort: 4 Byte Länge (LE) + Stempel als JSON + Dateiinhalt.
#[tauri::command]
pub async fn book_file_read(path: String) -> Result<Response, FileError> {
    let p = checked(&path, READABLE)?;
    let (bytes, stamp) = read_consistent(&p)?;
    let header = serde_json::to_vec(&stamp).map_err(|e| FileError::Io { message: e.to_string() })?;
    let mut out = Vec::with_capacity(4 + header.len() + bytes.len());
    out.extend_from_slice(&(header.len() as u32).to_le_bytes());
    out.extend_from_slice(&header);
    out.extend_from_slice(&bytes);
    Ok(Response::new(out))
}

/// Stempel einer Datei; `null`, wenn es sie nicht (mehr) gibt. Hash nur auf Wunsch.
#[tauri::command]
pub async fn book_file_stamp(path: String, hash: bool) -> Result<Option<FileStamp>, FileError> {
    let p = checked(&path, READABLE)?;
    match fs::metadata(&p) {
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.into()),
        Ok(meta) if !hash => Ok(Some(quick_stamp(&meta))),
        Ok(_) => Ok(Some(read_consistent(&p)?.1)),
    }
}

fn header<'a>(request: &'a Request<'_>, name: &str) -> Option<&'a str> {
    request.headers().get(name).and_then(|v| v.to_str().ok())
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// `.hbook` atomar schreiben. Header: `x-path` (URI-kodiert), optional `x-expected` (SHA-256 der
/// zuletzt bekannten Fassung) und `x-force: 1` (Konfliktprüfung überspringen, z. B. „Speichern unter“).
#[tauri::command]
pub async fn book_file_write(request: Request<'_>) -> Result<FileStamp, FileError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(FileError::Io { message: "Dateiinhalt fehlt".into() });
    };
    let path = header(&request, "x-path")
        .and_then(percent_decode)
        .ok_or_else(|| FileError::Io { message: "Pfad fehlt".into() })?;
    let p = checked(&path, WRITABLE)?;
    let expected = header(&request, "x-expected").filter(|s| !s.is_empty());
    let force = header(&request, "x-force") == Some("1");

    if !force {
        if let Some(expected) = expected {
            match read_consistent(&p) {
                Ok((_, current)) if current.sha256.as_deref() != Some(expected) => {
                    return Err(FileError::Conflict { current });
                }
                Ok(_) => {}
                Err(err) if err.kind() == io::ErrorKind::NotFound => {
                    return Err(FileError::NotFound { message: format!("Die Datei gibt es nicht mehr: {path}") });
                }
                Err(err) => return Err(err.into()),
            }
        }
    }

    write_atomic(&p, bytes)?;
    let meta = fs::metadata(&p)?;
    Ok(FileStamp { sha256: Some(sha256_hex(bytes)), ..quick_stamp(&meta) })
}

// ------------------------------------------------------------------------------------------ //
// Dateien, mit denen die App geöffnet wurde (Doppelklick, „Öffnen mit“, zweiter Start)
// ------------------------------------------------------------------------------------------ //

#[derive(Default)]
pub struct OpenedFiles(pub Mutex<Vec<String>>);

/// Programmargumente → vorhandene, unterstützte Dateien als absolute Pfade.
pub fn paths_from_args<I: IntoIterator<Item = String>>(args: I, cwd: &Path) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| {
            let p = PathBuf::from(a);
            if p.is_absolute() { p } else { cwd.join(p) }
        })
        .filter(|p| p.is_file() && has_extension(p, READABLE))
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

pub fn push_opened<R: Runtime>(app: &AppHandle<R>, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if let Ok(mut list) = app.state::<OpenedFiles>().0.lock() {
        list.extend(paths);
    }
    let _ = app.emit("open-files", ());
}

#[tauri::command]
pub fn take_opened_files(state: State<'_, OpenedFiles>) -> Vec<String> {
    state.0.lock().map(|mut l| std::mem::take(&mut *l)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sprechbuch-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn atomar_schreiben_ersetzt_und_hinterlaesst_nichts() {
        let dir = temp_dir("atomic");
        let file = dir.join("buch.hbook");
        write_atomic(&file, b"eins").unwrap();
        write_atomic(&file, b"zwei, laenger").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"zwei, laenger");
        let entries: Vec<_> = fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(entries.len(), 1, "keine temporären Reste: {entries:?}");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn stempel_und_pfadpruefung() {
        let dir = temp_dir("stamp");
        let file = dir.join("buch.hbook");
        fs::write(&file, b"abc").unwrap();
        let (bytes, stamp) = read_consistent(&file).unwrap();
        assert_eq!(bytes, b"abc");
        assert_eq!(stamp.size, 3);
        assert_eq!(stamp.sha256.as_deref(), Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
        assert!(matches!(checked("relativ/buch.hbook", READABLE), Err(FileError::Forbidden { .. })));
        assert!(matches!(checked(dir.join("x.exe").to_str().unwrap(), READABLE), Err(FileError::Forbidden { .. })));
        assert!(matches!(checked(dir.join("x.epub").to_str().unwrap(), WRITABLE), Err(FileError::Forbidden { .. })));
        assert!(checked(dir.join("X.HBOOK").to_str().unwrap(), WRITABLE).is_ok());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn argumente_werden_zu_vorhandenen_dateien() {
        let dir = temp_dir("args");
        fs::write(dir.join("a.hbook"), b"x").unwrap();
        fs::write(dir.join("b.txt"), b"x").unwrap();
        let args = ["sprechbuch.exe", "--flag", "a.hbook", "b.txt", "fehlt.epub"].map(String::from);
        let paths = paths_from_args(args, &dir);
        assert_eq!(paths, vec![dir.join("a.hbook").to_string_lossy().into_owned()]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn prozent_dekodierung() {
        assert_eq!(percent_decode("C%3A%5CB%C3%BCcher%5Cbuch.hbook").as_deref(), Some("C:\\Bücher\\buch.hbook"));
        assert_eq!(percent_decode("%zz"), None);
    }
}
