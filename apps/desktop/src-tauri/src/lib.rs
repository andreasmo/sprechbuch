mod ai;
mod files;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Nur eine Instanz: Ein zweiter Start (z. B. Doppelklick auf eine weitere .hbook-Datei)
    // reicht seine Dateien an das laufende Fenster weiter.
    #[cfg(desktop)]
    {
        use tauri::Manager;
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            files::push_opened(app, files::paths_from_args(argv, std::path::Path::new(&cwd)));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(files::OpenedFiles::default())
        .manage(ai::HttpClient::new())
        .invoke_handler(tauri::generate_handler![
            files::book_file_read,
            files::book_file_stamp,
            files::book_file_write,
            files::take_opened_files,
            ai::ai_key_status,
            ai::ai_key_set,
            ai::ai_key_delete,
            ai::ai_http,
        ])
        .setup(|app| {
            let cwd = std::env::current_dir().unwrap_or_default();
            files::push_opened(app.handle(), files::paths_from_args(std::env::args(), &cwd));
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // macOS übergibt Dateien (Doppelklick im Finder, „Öffnen mit“) als Ereignis statt als Argument
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = _event {
                let paths = urls
                    .into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect::<Vec<_>>();
                let cwd = std::env::current_dir().unwrap_or_default();
                let args = std::iter::once(String::new()).chain(paths);
                files::push_opened(_app, files::paths_from_args(args, &cwd));
            }
        });
}
