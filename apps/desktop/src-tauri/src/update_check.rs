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

use crate::notifications::{self, Action, Kind, Notice};
use crate::tr;
use std::sync::atomic::{AtomicBool, Ordering};
static DOWNLOADING: AtomicBool = AtomicBool::new(false);

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
                let _ = check_once(&h, auto_download, true);
            }
            std::thread::sleep(std::time::Duration::from_secs(6 * 3600));
        }
    });
}

/// 手动/定时共用的单次检查。auto_download=true 时发现新版立即后台下载。
pub fn check_once(
    app: &AppHandle,
    auto_download: bool,
    notify_available: bool,
) -> Result<Option<String>, String> {
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
            if notify_available {
                let mut notice = Notice::new(Kind::Info, "update.available", "update-available");
                notice.description = format!("v{version}");
                notice.actions = vec![Action::Settings];
                notifications::publish(app, notice);
            }
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
    if DOWNLOADING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    notifications::publish(
        app,
        Notice::new(Kind::Progress, "update.download", "update-download"),
    );
    let result = download_inner(app);
    DOWNLOADING.store(false, Ordering::SeqCst);
    match &result {
        Ok(()) => {
            let mut notice = Notice::new(Kind::Success, "update.ready", "update-download");
            notice.actions = vec![Action::Settings];
            notifications::publish(app, notice);
        }
        Err(error) => {
            if let Some(mut info) = current(app) {
                info.progress = None;
                set_current(app, Some(info));
            }
            let mut notice = Notice::new(Kind::Error, "update.failed", "update-download");
            notice.details = error.clone();
            notice.actions = vec![Action::RetryDownload, Action::Settings];
            notifications::publish(app, notice);
        }
    }
    result
}
fn download_inner(app: &AppHandle) -> Result<(), String> {
    let update = PENDING
        .lock()
        .ok()
        .and_then(|p| p.clone())
        .ok_or_else(|| "没有待下载的更新".to_string())?;

    let h = app.clone();
    let mut downloaded: u64 = 0;
    let mut last_notice = std::time::Instant::now() - Duration::from_secs(1);
    let bytes = tauri::async_runtime::block_on(update.download(
        move |chunk, total| {
            downloaded += chunk as u64;
            if let Some(info) = current(&h) {
                let info = UpdateInfo {
                    progress: Some((downloaded, total.unwrap_or(0))),
                    ..info
                };
                if let Ok(mut current) = CURRENT.lock() {
                    *current = Some(info.clone());
                }
                let _ = h.emit("update://state", &info);
                if last_notice.elapsed() >= Duration::from_millis(250) {
                    last_notice = std::time::Instant::now();
                    let mut notice =
                        Notice::new(Kind::Progress, "update.download", "update-download");
                    notice.progress = total
                        .filter(|size| *size > 0)
                        .map(|size| downloaded as f64 / size as f64 * 100.0);
                    notifications::publish(&h, notice);
                }
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
/// 用户实测（#86）：install 仅替换 .app，不会自动退出/重启——
/// 必须显式 restart()。运行中的内核经描述符由新实例收养，无缝衔接。
pub fn install(app: &AppHandle) -> Result<(), String> {
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
    update.install(bytes).map_err(|e| e.to_string())?;
    // 替换成功：以新包重启（内部完成清理后退出并拉起新实例）
    app.restart()
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
        tr(
            &lang,
            "发现新版本 · 点击前往更新",
            "New version · click to update"
        ),
        info.version
    ))
}
