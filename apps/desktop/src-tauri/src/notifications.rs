//! Session-owned notification queue. Webviews only render it; destroying the
//! main window must not lose errors or restart notification lifetimes.
use regex::Regex;
use std::collections::{HashSet, VecDeque};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex, OnceLock,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

const EVENT: &str = "app://notifications";
const OVERLAY: &str = "notifications";
const MAX_PENDING: usize = 30;
const MAX_HISTORY: usize = 50;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Success,
    Info,
    Warning,
    Error,
    Progress,
}
impl Kind {
    fn duration(self) -> Option<u64> {
        match self {
            Self::Success => Some(3000),
            Self::Info => Some(5000),
            Self::Warning => Some(8000),
            _ => None,
        }
    }
    fn priority(self) -> u8 {
        match self {
            Self::Error => 0,
            Self::Warning => 1,
            Self::Progress => 2,
            _ => 3,
        }
    }
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Settings,
    Diagnostics,
    Logs,
    Profiles,
    #[serde(rename = "retryDownload")]
    RetryDownload,
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    #[serde(default)]
    pub id: String,
    pub kind: Kind,
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub details: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub operation_id: String,
    #[serde(default)]
    pub dedupe_key: String,
    #[serde(default)]
    pub duration: Option<u64>,
    #[serde(default)]
    pub actions: Vec<Action>,
    #[serde(default)]
    pub progress: Option<f64>,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub count: u32,
    #[serde(default)]
    pub dismissed: bool,
    #[serde(skip)]
    remaining: Option<u64>,
    #[serde(skip)]
    paused: bool,
}
impl Notice {
    pub fn new(kind: Kind, code: &str, source: &str) -> Self {
        Self {
            id: String::new(),
            kind,
            code: code.into(),
            title: String::new(),
            description: String::new(),
            details: String::new(),
            source: source.into(),
            operation_id: source.into(),
            dedupe_key: String::new(),
            duration: None,
            actions: vec![],
            progress: None,
            created_at: 0,
            count: 0,
            dismissed: false,
            remaining: None,
            paused: false,
        }
    }
}
#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    revision: u64,
    active: Vec<Notice>,
    history: Vec<Notice>,
    navigate_to: Option<String>,
}
#[derive(Default)]
struct Queue {
    entries: VecDeque<Notice>,
    revision: u64,
    ready: HashSet<String>,
    target: String,
    delivered_revision: u64,
    navigate_to: Option<String>,
}
impl Queue {
    fn push(&mut self, mut notice: Notice) -> String {
        let now = now_ms();
        notice.title = redact(&notice.title);
        notice.description = redact(&notice.description);
        notice.details = redact(&notice.details);
        notice.id = notice.id.chars().take(160).collect();
        notice.operation_id = notice.operation_id.chars().take(160).collect();
        notice.dedupe_key = notice.dedupe_key.chars().take(160).collect();
        notice.progress = notice
            .progress
            .filter(|p| p.is_finite())
            .map(|p| p.clamp(0.0, 100.0));
        let existing = self.entries.iter().position(|n| {
            (!notice.id.is_empty() && n.id == notice.id)
                || (!notice.operation_id.is_empty() && n.operation_id == notice.operation_id)
                || (!notice.dedupe_key.is_empty() && n.dedupe_key == notice.dedupe_key)
        });
        notice.remaining = notice
            .duration
            .or_else(|| notice.kind.duration())
            .filter(|ms| *ms > 0);
        notice.duration = notice.remaining;
        notice.dismissed = false;
        notice.created_at = now;
        notice.count = 1;
        if let Some(index) = existing {
            let old = &self.entries[index];
            let repeated = old.kind == notice.kind
                && old.code == notice.code
                && old.title == notice.title
                && old.details == notice.details
                && old.description == notice.description;
            notice.id = old.id.clone();
            notice.created_at = old.created_at;
            notice.count = if repeated && notice.kind != Kind::Progress {
                old.count.saturating_add(1)
            } else {
                1
            };
            notice.paused = old.paused;
            // Progress refreshes and identical faults must not resurrect a
            // dismissed card. A newly failed operation still becomes visible.
            notice.dismissed = old.dismissed
                && (repeated || (old.kind == Kind::Progress && notice.kind != Kind::Error));
            if repeated {
                notice.remaining = old.remaining;
            }
            self.entries.remove(index);
        }
        if notice.id.is_empty() {
            notice.id = uuid::Uuid::new_v4().to_string();
        }
        let id = notice.id.clone();
        self.entries.push_front(notice);
        while self.entries.iter().filter(|n| !n.dismissed).count() > MAX_PENDING {
            let index = self
                .entries
                .iter()
                .rposition(|n| !n.dismissed && n.kind != Kind::Error)
                .or_else(|| self.entries.iter().rposition(|n| !n.dismissed))
                .unwrap();
            self.entries[index].dismissed = true;
        }
        // Retaining recent history must never discard an unresolved error.
        while self.entries.len() > MAX_HISTORY {
            if let Some(index) = self.entries.iter().rposition(|entry| entry.dismissed) {
                self.entries.remove(index);
            } else {
                break;
            }
        }
        self.revision += 1;
        id
    }
    fn active(&self) -> Vec<Notice> {
        let mut active: Vec<_> = self
            .entries
            .iter()
            .filter(|n| !n.dismissed)
            .cloned()
            .collect();
        active.sort_by_key(|n| n.kind.priority());
        active.truncate(3);
        active
    }
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            revision: self.revision,
            active: self.active(),
            history: self.entries.iter().cloned().collect(),
            navigate_to: self.navigate_to.clone(),
        }
    }
    fn tick(&mut self, elapsed: u64) {
        if self.target.is_empty() || !self.ready.contains(&self.target) {
            return;
        }
        let active = self.active();
        for entry in self
            .entries
            .iter_mut()
            .filter(|n| active.iter().any(|a| a.id == n.id))
        {
            if entry.paused {
                continue;
            }
            if let Some(remaining) = entry.remaining.as_mut() {
                *remaining = remaining.saturating_sub(elapsed);
                if *remaining == 0 {
                    entry.dismissed = true;
                    self.revision += 1;
                }
            }
        }
    }
}
#[derive(Default)]
pub struct Notifications {
    queue: Mutex<Queue>,
    dispatching: AtomicBool,
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Sanitize before storage, display, history and clipboard. Subscription URLs
/// may embed credentials in their paths, so only their origin is retained.
pub fn redact(text: &str) -> String {
    static PATTERNS: OnceLock<(Regex, Regex, Regex)> = OnceLock::new();
    let (urls, bearer, keys) = PATTERNS.get_or_init(|| (
        Regex::new(r#"(?i)(?:https?|socks5|ss|trojan|vmess|vless)://[^\s<>\"']+"#).unwrap(),
        Regex::new(r#"(?i)bearer\s+[^\s,;"}]+"#).unwrap(),
        Regex::new(r#"(?i)((?:token|secret|password|passwd|authorization|api[_-]?key)[\"']?\s*[:=]\s*)(?:\"[^\"]*\"|'[^']*'|[^\s,;&}]+)"#).unwrap(),
    ));
    let clean = urls.replace_all(text, |caps: &regex::Captures<'_>| {
        url::Url::parse(&caps[0])
            .ok()
            .and_then(|u| {
                u.host_str()
                    .map(|host| format!("{}://{host}/[redacted]", u.scheme()))
            })
            .unwrap_or_else(|| "[redacted URL]".into())
    });
    let clean = bearer.replace_all(&clean, "Bearer [redacted]");
    keys.replace_all(&clean, "${1}[redacted]")
        .chars()
        .take(8000)
        .collect()
}
pub fn publish(app: &AppHandle, notice: Notice) {
    if let Some(service) = app.try_state::<Notifications>() {
        service
            .queue
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(notice);
    }
}
pub fn result(app: &AppHandle, source: &str, code: &str, result: Result<(), String>) {
    let mut notice = Notice::new(
        if result.is_ok() {
            Kind::Success
        } else {
            Kind::Error
        },
        code,
        source,
    );
    if let Err(error) = result {
        notice.details = error;
        notice.actions = vec![Action::Diagnostics];
    }
    publish(app, notice);
}
// Tauri's show() makes the window key on macOS. Order it in front without
// activation so background failures do not steal focus or close a tracked menu.
fn show_overlay(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    if let Ok(pointer) = window.ns_window() {
        // route() is dispatched exclusively on the AppKit event loop.
        unsafe {
            let native = &*pointer.cast::<objc2_app_kit::NSWindow>();
            native.orderFrontRegardless();
        }
    }
    #[cfg(windows)]
    if let Ok(handle) = window.hwnd() {
        unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::ShowWindow(
                handle.0 as _,
                windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNOACTIVATE,
            );
        }
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    let _ = window.show();
}
fn position_overlay(app: &AppHandle, window: &WebviewWindow) {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        let width = ((area.size.width as f64 / scale) - 32.0).clamp(240.0, 472.0);
        let _ = window.set_size(tauri::LogicalSize::new(width, 480.0));
        let _ = window.set_position(tauri::PhysicalPosition::new(
            area.position.x + ((area.size.width as f64 - width * scale) / 2.0) as i32,
            area.position.y + (16.0 * scale) as i32,
        ));
    }
}
fn route(app: &AppHandle, elapsed: u64) {
    let service = app.state::<Notifications>();
    let main = app.get_webview_window("main");
    let main_visible = main
        .as_ref()
        .map(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
        .unwrap_or(false);
    let has_notices = !service
        .queue
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .active()
        .is_empty();
    if !main_visible && has_notices && app.get_webview_window(OVERLAY).is_none() {
        let built = tauri::WebviewWindowBuilder::new(
            app,
            OVERLAY,
            tauri::WebviewUrl::App("index.html?notifications=1".into()),
        )
        .title("Crossbow Notifications")
        .inner_size(472.0, 480.0)
        .visible(false)
        .focused(false)
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .transparent(true)
        .shadow(false)
        .build();
        match built {
            Ok(window) => position_overlay(app, &window),
            Err(error) => eprintln!("notification overlay: {error}"),
        }
    }
    let mut queue = service.queue.lock().unwrap_or_else(|e| e.into_inner());
    let target = if main_visible && queue.ready.contains("main") {
        "main"
    } else if has_notices && !main_visible && queue.ready.contains(OVERLAY) {
        OVERLAY
    } else {
        ""
    };
    let changed_target = queue.target != target;
    if changed_target {
        queue.target = target.into();
        for entry in &mut queue.entries {
            entry.paused = false;
        }
        queue.revision += 1;
    } else {
        queue.tick(elapsed);
    }
    let needs_delivery = queue.revision != queue.delivered_revision;
    let snapshot = queue.snapshot();
    let target = queue.target.clone();
    if !target.is_empty() {
        queue.delivered_revision = queue.revision;
    }
    drop(queue);
    // All window operations run on the event loop without holding the queue.
    if let Some(window) = app.get_webview_window(OVERLAY) {
        let visible = target == OVERLAY && !snapshot.active.is_empty();
        if visible && !window.is_visible().unwrap_or(false) {
            position_overlay(app, &window);
            show_overlay(&window);
        }
        if !visible && window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        }
    }
    // Snapshots are revisioned so renderers ignore unchanged heartbeat delivery.
    if !needs_delivery {
        return;
    }
    if target == "main" {
        let _ = app.emit_to("main", EVENT, &snapshot);
    } else if target == OVERLAY {
        let _ = app.emit_to(OVERLAY, EVENT, &snapshot);
    }
}
pub fn install(app: &AppHandle) {
    app.manage(Notifications::default());
    let app = app.clone();
    std::thread::spawn(move || {
        let mut last = Instant::now();
        loop {
            std::thread::sleep(Duration::from_millis(250));
            let service = app.state::<Notifications>();
            if service.dispatching.swap(true, Ordering::SeqCst) {
                continue;
            }
            let elapsed = last.elapsed().as_millis().min(1000) as u64;
            last = Instant::now();
            let handle = app.clone();
            if app
                .run_on_main_thread(move || {
                    route(&handle, elapsed);
                    handle
                        .state::<Notifications>()
                        .dispatching
                        .store(false, Ordering::SeqCst);
                })
                .is_err()
            {
                break;
            }
        }
    });
}
pub fn window_destroyed(app: &AppHandle, label: &str) {
    if let Some(service) = app.try_state::<Notifications>() {
        service
            .queue
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .ready
            .remove(label);
    }
}
#[tauri::command]
pub fn notification_publish(service: State<Notifications>, notice: Notice) -> String {
    service
        .queue
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push(notice)
}
#[tauri::command]
pub fn notification_snapshot(window: WebviewWindow, service: State<Notifications>) -> Snapshot {
    let mut queue = service.queue.lock().unwrap_or_else(|e| e.into_inner());
    queue.ready.insert(window.label().into());
    queue.snapshot()
}
#[tauri::command]
pub fn notification_dismiss(service: State<Notifications>, id: String) {
    let mut queue = service.queue.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(entry) = queue.entries.iter_mut().find(|n| n.id == id) {
        entry.dismissed = true;
    }
    queue.revision += 1;
}
#[tauri::command]
pub fn notification_pause(
    window: WebviewWindow,
    service: State<Notifications>,
    id: String,
    paused: bool,
) {
    let mut queue = service.queue.lock().unwrap_or_else(|e| e.into_inner());
    if queue.target != window.label() {
        return;
    }
    if let Some(entry) = queue.entries.iter_mut().find(|n| n.id == id) {
        entry.paused = paused;
    }
}
#[tauri::command]
pub fn notification_action(app: AppHandle, service: State<Notifications>, action: Action) {
    if matches!(action, Action::RetryDownload) {
        std::thread::spawn(move || {
            let _ = crate::update_check::download_and_prepare(&app);
        });
        return;
    }
    let page = match action {
        Action::Settings => "settings",
        Action::Diagnostics => "diagnostics",
        Action::Logs => "logs",
        Action::Profiles => "profiles",
        Action::RetryDownload => unreachable!(),
    };
    {
        let mut queue = service.queue.lock().unwrap_or_else(|e| e.into_inner());
        queue.navigate_to = Some(page.into());
        queue.revision += 1;
    }
    crate::show_main_window(&app);
}
#[tauri::command]
pub fn notification_ack_navigation(window: WebviewWindow, service: State<Notifications>) {
    if window.label() == "main" {
        let mut queue = service.queue.lock().unwrap_or_else(|e| e.into_inner());
        queue.navigate_to = None;
        queue.revision += 1;
    }
}

#[tauri::command]
pub fn notification_resize(window: WebviewWindow, height: f64) {
    if window.label() != OVERLAY || !height.is_finite() {
        return;
    }
    if let Ok(size) = window.inner_size() {
        let scale = window.scale_factor().unwrap_or(1.0);
        let max = window
            .current_monitor()
            .ok()
            .flatten()
            .map(|m| m.work_area().size.height as f64 / m.scale_factor() - 32.0)
            .unwrap_or(640.0);
        let _ = window.set_size(tauri::LogicalSize::new(
            size.width as f64 / scale,
            height.clamp(60.0, max.max(60.0)),
        ));
    }
}
pub fn resolve_core_failure(app: &AppHandle) {
    let Some(service) = app.try_state::<Notifications>() else {
        return;
    };
    let unresolved = service
        .queue
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .entries
        .iter()
        .any(|n| n.operation_id == "core-failure" && n.kind == Kind::Error);
    if unresolved {
        publish(
            app,
            Notice::new(Kind::Success, "core.recovered", "core-failure"),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn visible_queue() -> Queue {
        let mut queue = Queue::default();
        queue.ready.insert("main".into());
        queue.target = "main".into();
        queue
    }
    #[test]
    fn secrets_are_removed_before_snapshot_and_history() {
        let mut queue = visible_queue();
        let mut notice = Notice::new(Kind::Error, "failure", "subscription");
        notice.title = "https://user:password@example.com/private-key?token=token-value".into();
        notice.details = "Authorization: Bearer bearer-value; secret=controller-value\n{\"password\":\"password with spaces\",\"token\":\"json-token\"}".into();
        queue.push(notice);
        let serialized = serde_json::to_string(&queue.snapshot()).unwrap();
        for secret in [
            "private-key",
            "token-value",
            "bearer-value",
            "controller-value",
            "password with spaces",
            "json-token",
            "user:password",
        ] {
            assert!(
                !serialized.contains(secret),
                "leaked {secret}: {serialized}"
            );
        }
        assert!(serialized.contains("redacted"));
    }
    #[test]
    fn displayed_time_pauses_without_a_renderer_and_while_interacting() {
        let mut queue = visible_queue();
        let id = queue.push(Notice::new(Kind::Success, "done", "save"));
        queue.tick(1000);
        queue.entries[0].paused = true;
        queue.tick(9000);
        assert_eq!(queue.entries[0].remaining, Some(2000));
        queue.entries[0].paused = false;
        queue.ready.clear(); // Destroyed webview: do not consume time.
        queue.tick(9000);
        queue.ready.insert("notifications".into());
        queue.target = "notifications".into();
        queue.tick(1999);
        assert_eq!(queue.active()[0].id, id);
        queue.tick(1);
        assert!(queue.active().is_empty());
        assert_eq!(queue.snapshot().history.len(), 1);
    }
    #[test]
    fn errors_preempt_progress_without_consuming_queued_lifetimes() {
        let mut queue = visible_queue();
        for source in ["download-a", "download-b", "download-c"] {
            queue.push(Notice::new(Kind::Progress, "download", source));
        }
        let queued = queue.push(Notice::new(Kind::Success, "saved", "save"));
        let error = queue.push(Notice::new(Kind::Error, "failed", "tun"));
        assert_eq!(queue.active()[0].id, error);
        queue.tick(5000);
        assert_eq!(
            queue
                .entries
                .iter()
                .find(|n| n.id == queued)
                .unwrap()
                .remaining,
            Some(3000)
        );
        assert!(
            !queue
                .entries
                .iter()
                .find(|n| n.id == error)
                .unwrap()
                .dismissed
        );
    }
    #[test]
    fn progress_and_results_share_a_card_and_dismissal_does_not_hide_failure() {
        let mut queue = visible_queue();
        let id = queue.push(Notice::new(Kind::Progress, "download", "op"));
        queue.entries[0].dismissed = true;
        let mut progress = Notice::new(Kind::Progress, "download", "op");
        progress.progress = Some(50.0);
        queue.push(progress);
        assert!(queue.active().is_empty());
        queue.push(Notice::new(Kind::Error, "failed", "op"));
        assert_eq!(queue.entries.len(), 1);
        assert_eq!(queue.active()[0].id, id);
        queue.push(Notice::new(Kind::Error, "failed", "op"));
        assert_eq!(queue.active()[0].count, 2);
        queue.entries[0].dismissed = true;
        queue.push(Notice::new(Kind::Error, "failed", "op"));
        assert!(queue.active().is_empty()); // Background repeats stay dismissed.
        queue.push(Notice::new(Kind::Progress, "retry", "op"));
        assert!(!queue.active().is_empty()); // An explicit retry is visible.
        queue.push(Notice::new(Kind::Success, "done", "op"));
        assert_eq!(queue.active()[0].duration, Some(3000));
    }
    #[test]
    fn unrelated_success_cannot_erase_error_and_queue_is_bounded() {
        let mut queue = visible_queue();
        let id = queue.push(Notice::new(Kind::Error, "failed", "tun"));
        for index in 0..200 {
            queue.push(Notice::new(
                Kind::Success,
                "saved",
                &format!("save-{index}"),
            ));
        }
        assert!(queue.entries.len() <= MAX_HISTORY);
        assert!(queue.entries.iter().filter(|n| !n.dismissed).count() <= MAX_PENDING);
        assert_eq!(queue.active().len(), 3);
        assert_eq!(queue.active()[0].id, id);
    }
}
