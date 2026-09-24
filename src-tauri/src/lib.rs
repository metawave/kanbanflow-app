use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuBuilder, MenuEvent, MenuItemBuilder, SubmenuBuilder};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_window_state::StateFlags;

const MAIN_WINDOW: &str = "main";
const START_URL: &str = "https://kanbanflow.com";
const APP_HOST: &str = "kanbanflow.com";
const PROJECT_URL: &str = "https://github.com/metawave/kanbanflow-app";

/// Zoom steps (same as common browsers)
const ZOOM_LEVELS: [f64; 15] = [
    0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0,
];
const DEFAULT_ZOOM_INDEX: usize = 7;

/// Runs in the main frame only. KanbanFlow links pointing to other hosts are
/// routed through `window.open`, which ends up in the new-window handler and
/// is opened in the system browser. Server-side redirects (e.g. SSO logins)
/// are not affected.
const EXTERNAL_LINK_SCRIPT: &str = r#"
document.addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!link) return;
  const url = new URL(link.href, location.href);
  const isWeb = url.protocol === 'http:' || url.protocol === 'https:';
  const isExternal = isWeb ? url.host !== location.host : url.protocol === 'mailto:' || url.protocol === 'tel:';
  if (!isExternal) return;
  event.preventDefault();
  window.open(url.href, '_blank');
}, true);
"#;

/// Settings that are not covered by the window-state plugin.
#[derive(Serialize, Deserialize)]
#[serde(default)]
struct Settings {
    zoom: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            zoom: ZOOM_LEVELS[DEFAULT_ZOOM_INDEX],
        }
    }
}

struct SettingsState(Mutex<Settings>);

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("settings.json"))
}

fn load_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|data| serde_json::from_str(&data).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle, settings: &Settings) {
    let Some(path) = settings_path(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(data) = serde_json::to_string_pretty(settings) {
        let _ = fs::write(path, data);
    }
}

fn is_app_host(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url
            .host_str()
            .is_some_and(|host| host == APP_HOST || host.ends_with(&format!(".{APP_HOST}")))
}

fn create_main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let zoom = app.state::<SettingsState>().0.lock().unwrap().zoom;
    let url = Url::parse(START_URL).expect("valid start url");
    let handle = app.clone();

    let window = WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::External(url))
        .title("KanbanFlow")
        .inner_size(1440.0, 900.0)
        .visible(false)
        .initialization_script(EXTERNAL_LINK_SCRIPT)
        .on_new_window(move |url, _features| {
            // KanbanFlow popups stay denied, everything else opens in the system browser
            if !is_app_host(&url) {
                let _ = handle.opener().open_url(url.as_str(), None::<&str>);
            }
            NewWindowResponse::Deny
        })
        .build()?;

    window.set_zoom(zoom)?;
    window.show()?;
    Ok(window)
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let reload = MenuItemBuilder::with_id("reload", "Reload Webapp").build(app)?;
    let zoom_in = MenuItemBuilder::with_id("zoom_in", "Zoom In")
        .accelerator("CmdOrCtrl+Shift+3")
        .build(app)?;
    let zoom_out = MenuItemBuilder::with_id("zoom_out", "Zoom Out")
        .accelerator("CmdOrCtrl+Shift+2")
        .build(app)?;
    let zoom_reset = MenuItemBuilder::with_id("zoom_reset", "Reset Zoom")
        .accelerator("CmdOrCtrl+Shift+1")
        .build(app)?;
    let about = MenuItemBuilder::with_id("about", "About").build(app)?;

    let mut file = SubmenuBuilder::new(app, "File").item(&reload);
    // on macOS quit lives in the app menu
    if !cfg!(target_os = "macos") {
        let quit = MenuItemBuilder::with_id("quit", "Quit")
            .accelerator("CmdOrCtrl+Q")
            .build(app)?;
        file = file.item(&quit);
    }

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&zoom_in)
        .item(&zoom_out)
        .separator()
        .item(&zoom_reset)
        .build()?;

    let help = SubmenuBuilder::new(app, "Help").item(&about).build()?;

    let mut menu = MenuBuilder::new(app);
    if cfg!(target_os = "macos") {
        let app_menu = SubmenuBuilder::new(app, app.package_info().name.clone())
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        menu = menu.item(&app_menu);
    }
    menu.item(&file.build()?)
        .item(&edit)
        .item(&view)
        .item(&help)
        .build()
}

fn change_zoom(app: &AppHandle, window: &WebviewWindow, direction: i8) {
    let state = app.state::<SettingsState>();
    let mut settings = state.0.lock().unwrap();

    let current = ZOOM_LEVELS
        .iter()
        .position(|level| (level - settings.zoom).abs() < 0.001)
        .unwrap_or(DEFAULT_ZOOM_INDEX);
    settings.zoom = match direction {
        1 => ZOOM_LEVELS[(current + 1).min(ZOOM_LEVELS.len() - 1)],
        -1 => ZOOM_LEVELS[current.saturating_sub(1)],
        _ => ZOOM_LEVELS[DEFAULT_ZOOM_INDEX],
    };

    let _ = window.set_zoom(settings.zoom);
    save_settings(app, &settings);
}

fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    match event.id().as_ref() {
        "reload" => {
            let _ = window.reload();
        }
        "quit" => app.exit(0),
        "zoom_in" => change_zoom(app, &window, 1),
        "zoom_out" => change_zoom(app, &window, -1),
        "zoom_reset" => change_zoom(app, &window, 0),
        "about" => {
            let _ = app.opener().open_url(PROJECT_URL, None::<&str>);
        }
        _ => {}
    }
}

async fn check_for_update(app: AppHandle) -> tauri_plugin_updater::Result<()> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };

    let install = app
        .dialog()
        .message(format!(
            "Version {} is available (installed: {}).\n\nInstall now and restart?",
            update.version, update.current_version
        ))
        .title("Update available")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Install".into(),
            "Later".into(),
        ))
        .blocking_show();

    if install {
        update.download_and_install(|_, _| {}, || {}).await?;
        app.restart();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .setup(|app| {
            let handle = app.handle();
            app.manage(SettingsState(Mutex::new(load_settings(handle))));

            app.set_menu(build_menu(handle)?)?;
            app.on_menu_event(handle_menu_event);

            create_main_window(handle)?;

            let updater_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = check_for_update(updater_handle).await {
                    eprintln!("update check failed: {err}");
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // macOS: closing the window keeps the app running, the dock icon brings it back
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                if let Some(window) = _app.get_webview_window(MAIN_WINDOW) {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
