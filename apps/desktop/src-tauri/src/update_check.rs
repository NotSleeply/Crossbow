//! 应用更新（#28）：tauri-plugin-updater 的 Rust 侧编排。
//!
//! 检查（启动 30s 后 + 每 6h + 手动）→ 发现新版：发 `update://state` 事件、
//! 托盘菜单出现「发现新版本」入口；「自动下载」开启时后台下载，完成后
//! 提示重启安装。模块级状态（CURRENT/PENDING/DOWNLOADED）避免侵入
//! AppState，逻辑平台无关——插件双平台同构。

use std::sync::Mutex;
use std::time::Duration;

use tauri::AppHandle;
use tauri::Emitter as _;
use tauri::Manager as _;
use tauri_plugin_updater::Update;
use tauri_plugin_updater::UpdaterExt;

use crate::tr;

#[derive(Debug, Clone, serde::Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
    /// 是否已下载完成（显示「重启完成安装」按钮）
    pub downloaded: bool,
    /// (已下载字节, 总字节)；下载中有值
    pub progress: Option<(u64, u64)>,
}

static CURRENT: Mutex<Option<UpdateInfo>> = Mutex::new(None);
static PENDING: Mutex<Option<Update>> = Mutex::new(None);
static DOWNLOADED: Mutex<Option<Vec<u8>>> = Mutex::new(None);

pub fn current(_app: &AppHandle) -> Option<UpdateInfo> {
    CURRENT.lock().ok().and_then(|c| c.clone())
}

fn set_current(app: &AppHandle, info: Option<UpdateInfo>) {
    if let Ok(mut c) = CURRENT.lock() {
        *c = info.clone();
    }
    let _ = app.emit("update://state", info);
    // 托盘菜单的「发现新版本」入口随状态出现/消失
    crate::refresh_tray(app);
}

/// 后台检查线程：启动 30s 后首查，之后每 6h 一轮；每轮读当前设置。
pub fn spawn_checker(app: &AppHandle) {
    let h = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(30));
        loop {
            let (auto_check, auto_download) = update_settings(&h);
            if auto_check {
                let _ = check_once(&h, auto_download);
            }
            std::thread::sleep(std::time::Duration::from_secs(6 * 3600));
        }
    });
}

/// 手动/定时共用的单次检查。auto_download=true 时发现新版立即后台下载。
pub fn check_once(app: &AppHandle, auto_download: bool) -> Result<Option<String>, String> {
    let updater = app.updater_builder().build().map_err(|e| e.to_string())?;
    // Updater requests have no default timeout. Limit only the check, so a slow
    // download is not aborted by the same deadline.
    let update = tauri::async_runtime::block_on(async {
        tokio::time::timeout(Duration::from_secs(20), updater.check()).await
    })
    .map_err(|_| "UPDATE_CHECK_TIMEOUT".to_string())?
    .map_err(|e| e.to_string())?;
    match update {
        Some(u) => {
            let version = u.version.clone();
            let notes = u.body.clone();
            if let Ok(mut p) = PENDING.lock() {
                *p = Some(u);
            }
            set_current(
                app,
                Some(UpdateInfo {
                    version: version.clone(),
                    notes,
                    downloaded: false,
                    progress: None,
                }),
            );
            if auto_download {
                let h = app.clone();
                std::thread::spawn(move || {
                    if let Err(e) = download_and_prepare(&h) {
                        eprintln!("update auto-download: {e}");
                    }
                });
            }
            Ok(Some(version))
        }
        None => {
            set_current(app, None);
            Ok(None)
        }
    }
}

/// 下载当前已发现的新版本；完成后置 downloaded=true 并提示重启。
pub fn download_and_prepare(app: &AppHandle) -> Result<(), String> {
    let update = PENDING
        .lock()
        .ok()
        .and_then(|p| p.clone())
        .ok_or_else(|| "没有待下载的更新".to_string())?;

    let h = app.clone();
    let mut downloaded: u64 = 0;
    let bytes = tauri::async_runtime::block_on(update.download(
        move |chunk, total| {
            downloaded += chunk as u64;
            if let Some(info) = current(&h) {
                let info = UpdateInfo {
                    progress: Some((downloaded, total.unwrap_or(0))),
                    ..info
                };
                set_current(&h, Some(info));
            }
        },
        || {},
    ))
    .map_err(|e| e.to_string())?;
    if let Ok(mut b) = DOWNLOADED.lock() {
        *b = Some(bytes);
    }

    if let Ok(mut c) = CURRENT.lock() {
        if let Some(info) = c.as_mut() {
            info.downloaded = true;
            info.progress = None;
        }
    }
    let info = current(app);
    let _ = app.emit("update://state", info);
    Ok(())
}

/// 重启并安装（macOS：替换 .app 后自动重启）。
pub fn install(_app: &AppHandle) -> Result<(), String> {
    let bytes = DOWNLOADED
        .lock()
        .ok()
        .and_then(|b| b.clone())
        .ok_or_else(|| "更新尚未下载".to_string())?;
    let update = PENDING
        .lock()
        .ok()
        .and_then(|p| p.clone())
        .ok_or_else(|| "没有待安装的更新".to_string())?;
    update.install(bytes).map_err(|e| e.to_string())
}

pub fn update_settings(app: &AppHandle) -> (bool, bool) {
    let Some(state) = app.try_state::<crate::AppState>() else {
        return (true, false);
    };
    let store = state.store.lock().unwrap_or_else(|e| e.into_inner());
    let u = &store.data().update;
    (u.auto_check, u.auto_download)
}

/// 设置页展示用的双语摘要（托盘菜单项标题同源）。
pub fn tray_label(app: &AppHandle) -> Option<String> {
    let info = current(app)?;
    let lang = app
        .try_state::<crate::AppState>()
        .map(|s| s.store.lock().map(|st| st.data().ui.lang.clone()).ok())
        .and_then(|l| l)?;
    Some(format!(
        "{} v{}",
        tr(&lang, "发现新版本 · 点击前往更新", "New version · click to update"),
        info.version
    ))
}
