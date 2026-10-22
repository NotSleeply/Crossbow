//! macOS 菜单栏实时速率：NSStatusItem 富文本双行标题（借鉴 Clash Verge Rev 的
//! 公开技术方案，实现独立编写）。
//!
//! 系统菜单栏高 24pt，默认字号塞不下两行；方案：9pt 等宽字体 + 固定 10pt 行高 +
//! 精确基线偏移把两行垂直居中在按钮内，并按内容宽度设定 status item 长度以避免
//! 每秒抖动。仅 macOS，其余平台为空操作。

use crate::tray_state::TrayNodeRow;
use tauri::{AppHandle, Manager};

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{define_class, msg_send, AnyThread, DeclaredClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::NSAttributedStringNSStringDrawing as _;
use objc2_app_kit::{
    NSApplication, NSBaselineOffsetAttributeName, NSColor, NSEvent, NSFont,
    NSFontAttributeName, NSFontWeightMedium, NSFontWeightRegular,
    NSForegroundColorAttributeName, NSLineBreakMode, NSMenu, NSMenuItem, NSMutableParagraphStyle,
    NSMenuDidBeginTrackingNotification, NSParagraphStyleAttributeName, NSStatusBarButton,
    NSStatusItem, NSTextAlignment, NSTextField, NSTrackingArea, NSTrackingAreaOptions, NSView,
};
use objc2_foundation::{
    NSAttributedString, NSAttributedStringKey, NSDictionary, NSNumber, NSNotification,
    NSNotificationCenter, NSObject, NSObjectProtocol, NSString,
};

const FONT_SIZE: f64 = 9.5;
const LINE_HEIGHT: f64 = 10.0;
// 图标占位 + 系统内边距（Tauri 图标 18pt）。
const EXTRA_WIDTH: f64 = 30.0;
// 短值（如 ↓0B↑0B）防抖的最小宽度。
const MIN_LENGTH: f64 = 56.0;
const NS_VARIABLE_LENGTH: f64 = -1.0;

thread_local! {
    /// 内容不变时跳过重设（每秒一次的 tick 大多数帧是无变化的）。
    static LAST: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) };
    static MENU_OBSERVER: std::cell::RefCell<Option<Retained<TrayMenuObserver>>> = const { std::cell::RefCell::new(None) };
}

// 速率文本：上行在上、下行在下；每行 `{:>6}` 填充——等宽字体下
// 字符数恒定 ⇒ 托盘宽度恒定，不随数字变化抖动（Verge 同款方案）。
fn speed_text(up: u64, down: u64) -> String {
    format!("{:>6}\n{:>6}", speed_str(up), speed_str(down))
}

// 紧凑速率串，输出保证 ≤6 字符：<1000 → `999B/s`；否则选单位让数值
// 落在 1000 以内，<9.95 一位小数（`9.9K/s`），其余取整（`123M/s`）。
fn speed_str(bps: u64) -> String {
    const UNITS: [&str; 5] = ["B/s", "K/s", "M/s", "G/s", "T/s"];
    if bps < 1000 {
        return format!("{bps}B/s");
    }
    let mut u = (u64::ilog2(bps) / 10) as usize;
    u = u.min(UNITS.len() - 1);
    let mut v = bps as f64 / 1024f64.powi(u as i32);
    if v.round() >= 1000.0 && u < UNITS.len() - 1 {
        u += 1;
        v = bps as f64 / 1024f64.powi(u as i32);
    }
    if v < 9.95 {
        format!("{v:.1}{}", UNITS[u])
    } else {
        format!("{:.0}{}", v.round(), UNITS[u])
    }
}

// 按钮高度构建属性字典：等宽小字 + 系统文字色 + 固定行高 + 垂直居中基线。
fn build_attrs(button_height: f64) -> Retained<NSDictionary<NSAttributedStringKey, AnyObject>> {
    unsafe {
        // Medium 字重：9.5pt 细体在暗色菜单栏上光学偏灰，加粗一档提亮
        let font = NSFont::monospacedSystemFontOfSize_weight(FONT_SIZE, NSFontWeightMedium);
        let color = NSColor::controlTextColor();
        let para = NSMutableParagraphStyle::new();
        para.setAlignment(NSTextAlignment::Right);
        para.setLineBreakMode(NSLineBreakMode::ByClipping);
        para.setMinimumLineHeight(LINE_HEIGHT);
        para.setMaximumLineHeight(LINE_HEIGHT);
        // 基线下移把两行文本块在按钮内垂直居中
        let glyph_height = font.ascender() - font.descender();
        let free = LINE_HEIGHT * 2.0 - button_height;
        let baseline = NSNumber::new_f64(-(glyph_height / 3.0) + free / 2.0);

        let keys: &[&NSAttributedStringKey] = &[
            NSFontAttributeName,
            NSForegroundColorAttributeName,
            NSParagraphStyleAttributeName,
            NSBaselineOffsetAttributeName,
        ];
        let values: &[&AnyObject] = &[&font, &color, &para, &baseline];
        NSDictionary::from_slices(keys, values)
    }
}

/// NSTextField label cells in custom NSMenuItem views align their baseline too
/// high in these compact rows. Shift glyphs down without moving the row or its
/// background (notably the latency badge) so all text is optically centered.
fn set_menu_label_text(label: &NSTextField, text: &str) {
    unsafe {
        let value = NSString::from_str(text);
        let offset = NSNumber::new_f64(-2.0);
        let attrs = NSDictionary::from_slices(
            &[NSBaselineOffsetAttributeName],
            &[&*offset as &AnyObject],
        );
        let attributed = NSAttributedString::new_with_attributes(&value, &attrs);
        label.setAttributedStringValue(&attributed);
    }
}

// 主线程应用富文本标题（with_inner_tray_icon 的回调在主线程执行）。
fn apply(status_item: &NSStatusItem, text: &str, show_speed: bool) {
    let Some(mtm) = MainThreadMarker::new() else {
        eprintln!("tray_speed: not on main thread, skip");
        return;
    };
    let Some(button): Option<Retained<NSStatusBarButton>> = status_item.button(mtm) else {
        return;
    };
    let ns_text = NSString::from_str(text);
    let attr_str = if show_speed {
        let attrs = build_attrs(button.bounds().size.height);
        unsafe { NSAttributedString::new_with_attributes(&ns_text, &attrs) }
    } else {
        NSAttributedString::from_nsstring(&ns_text)
    };
    if show_speed {
        let width = attr_str.size().width.ceil() + EXTRA_WIDTH;
        let length = width.max(MIN_LENGTH);
        if status_item.length() != length {
            status_item.setLength(length);
        }
    }
    button.setAttributedTitle(&attr_str);

    // tray-icon routes status-item clicks through a transparent TrayTarget
    // subview created at the button's original icon-only size. Changing the
    // NSStatusItem length does not resize that subview, so the added title area
    // looks clickable but misses menu events. Keep the hit target covering the
    // full button whenever its title/length changes.
    if let Some(target) = button.subviews().firstObject() {
        target.setFrame(button.bounds());
    }
}

// 更新托盘速率双行显示。
pub fn set_speed(handle: &AppHandle, up: u64, down: u64) {
    let text = speed_text(up, down);
    LAST.with(|last| {
        if last.borrow().as_str() == text {
            return;
        }
        *last.borrow_mut() = text.clone();
        let text_for_apply = text.clone();
        let _ = handle.tray_by_id_or_first(move |item| {
            apply(item, &text_for_apply, true);
        });
    });
}

// 清空速率显示（内核停止等场景），status item 宽度恢复自适应。
pub fn clear(handle: &AppHandle) {
    LAST.with(|last| *last.borrow_mut() = String::new());
    let _ = handle.tray_by_id_or_first(|item| {
        item.setLength(NS_VARIABLE_LENGTH);
        apply(item, "", false);
    });
}

// 取应用唯一的托盘（我们不建多个），在主线程上执行操作。
trait TrayExt {
    fn tray_by_id_or_first(
        &self,
        f: impl FnOnce(&NSStatusItem) + Send + 'static,
    ) -> Result<(), String>;
}

impl TrayExt for AppHandle {
    fn tray_by_id_or_first(
        &self,
        f: impl FnOnce(&NSStatusItem) + Send + 'static,
    ) -> Result<(), String> {
        use tauri::Manager;
        let state = self.state::<crate::AppState>();
        let tray = state.tray.lock().unwrap().clone();
        let Some(tray) = tray else {
            return Err("no tray".into());
        };
        tray.with_inner_tray_icon(move |inner| {
            if let Some(item) = inner.ns_status_item() {
                f(&item);
            }
        })
        .map_err(|e| e.to_string())
    }
}

// ---------- 托盘节点子菜单：固定宽度、右对齐测速列 ----------

// 近似显示宽度：CJK/全角/emoji 记 2，其余记 1。
pub fn display_width(s: &str) -> usize {
    s.chars()
        .map(|c| {
            let cp = c as u32;
            if cp >= 0x1100
                && ((0x1100..=0x115F).contains(&cp)
                    || (0x2E80..=0xA4CF).contains(&cp)
                    || (0xAC00..=0xD7A3).contains(&cp)
                    || (0xF900..=0xFAFF).contains(&cp)
                    || (0xFE30..=0xFE4F).contains(&cp)
                    || (0xFF00..=0xFF60).contains(&cp)
                    || (0xFFE0..=0xFFE6).contains(&cp)
                    || cp >= 0x1F300)
            {
                2
            } else {
                1
            }
        })
        .sum()
}

// 递归遍历托盘主菜单与子菜单，对测速可用态、节点富文本和勾选态做原地更新。
// 不调用 set_menu——菜单打开时刷新可见、不关闭。

// 单个节点行数据（lib.rs 组装，tray_speed 负责原生渲染与原地刷新）。
fn delay_color(ms: Option<u64>, badge: &str) -> Retained<NSColor> {
    if badge == "失败" {
        return NSColor::systemRedColor();
    }
    match ms {
        Some(ms) if ms <= 300 => NSColor::systemGreenColor(),
        Some(_) => NSColor::systemOrangeColor(),
        _ => NSColor::systemGrayColor(),
    }
}

const ROW_VIEW_NAME_TAG: isize = 101;
const ROW_VIEW_CHECK_TAG: isize = 102;
const ROW_VIEW_BADGE_TAG: isize = 103;
const ACTION_ROW_VIEW_LABEL_TAG: isize = 104;
const SUBMENU_ROW_LABEL_TAG: isize = 105;
const SUBMENU_ROW_CHEVRON_TAG: isize = 106;
const NODE_MENU_WIDTH: f64 = 260.0;
const NODE_ROW_HEIGHT: f64 = 23.0;
const ACTION_ROW_HEIGHT: f64 = NODE_ROW_HEIGHT;
const SUBMENU_ROW_HEIGHT: f64 = NODE_ROW_HEIGHT;
const HOVER_HORIZONTAL_INSET: f64 = 4.0;
const HOVER_CORNER_RADIUS: f64 = 7.0;

// NSMenuItem custom views do not automatically dispatch the menu item's action.
// Forward the click to the original target/action so Tauri still receives the
// same menu event as it does for a standard check-menu item.
define_class!(
    #[unsafe(super(NSView))]
    #[name = "CrossbowTrayNodeRowView"]
    #[thread_kind = MainThreadOnly]
    struct TrayNodeRowView;

    unsafe impl NSObjectProtocol for TrayNodeRowView {}

    impl TrayNodeRowView {
        #[unsafe(method(updateTrackingAreas))]
        fn update_tracking_areas(&self) {
            unsafe {
                let _: () = msg_send![super(self), updateTrackingAreas];
            }
            install_hover_tracking(self);
        }

        #[unsafe(method(mouseEntered:))]
        fn on_mouse_entered(&self, _event: &NSEvent) {
            set_row_hovered(self, true, &[ROW_VIEW_NAME_TAG, ROW_VIEW_CHECK_TAG]);
        }

        #[unsafe(method(mouseExited:))]
        fn on_mouse_exited(&self, _event: &NSEvent) {
            set_row_hovered(self, false, &[ROW_VIEW_NAME_TAG, ROW_VIEW_CHECK_TAG]);
        }

        #[unsafe(method(mouseDown:))]
        fn on_mouse_down(&self, _event: &NSEvent) {
            let Some(item) = self.enclosingMenuItem() else { return };
            if let Some(action) = item.action() {
                let mtm = MainThreadMarker::new().expect("menu click runs on the main thread");
                let app = NSApplication::sharedApplication(mtm);
                let target = item.target();
                unsafe {
                    app.sendAction_to_from(action, target.as_deref(), Some(&*item));
                }
            }
            if let Some(menu) = unsafe { item.menu() } {
                menu.cancelTracking();
            }
        }
    }
);

// Unlike node selection, triggering latency testing should leave the whole
// menu hierarchy open. A custom action row forwards the action itself without
// cancelling NSMenu tracking, allowing the same submenu to refresh in place.
define_class!(
    #[unsafe(super(NSView))]
    #[name = "CrossbowTrayActionRowView"]
    #[thread_kind = MainThreadOnly]
    struct TrayActionRowView;

    unsafe impl NSObjectProtocol for TrayActionRowView {}

    impl TrayActionRowView {
        #[unsafe(method(updateTrackingAreas))]
        fn update_tracking_areas(&self) {
            unsafe {
                let _: () = msg_send![super(self), updateTrackingAreas];
            }
            install_hover_tracking(self);
        }

        #[unsafe(method(mouseEntered:))]
        fn on_mouse_entered(&self, _event: &NSEvent) {
            set_action_row_hovered(self, true);
        }

        #[unsafe(method(mouseExited:))]
        fn on_mouse_exited(&self, _event: &NSEvent) {
            set_action_row_hovered(self, false);
        }

        #[unsafe(method(mouseDown:))]
        fn on_mouse_down(&self, _event: &NSEvent) {
            let Some(item) = self.enclosingMenuItem() else { return };
            if let Some(action) = item.action() {
                let mtm = MainThreadMarker::new().expect("menu click runs on the main thread");
                let app = NSApplication::sharedApplication(mtm);
                let target = item.target();
                unsafe {
                    app.sendAction_to_from(action, target.as_deref(), Some(&*item));
                }
            }
        }
    }
);

fn make_action_row_view(mtm: MainThreadMarker) -> Retained<TrayActionRowView> {
    let frame = objc2_foundation::NSRect::new(
        objc2_foundation::NSPoint::new(0.0, 0.0),
        objc2_foundation::NSSize::new(NODE_MENU_WIDTH, ACTION_ROW_HEIGHT),
    );
    let view: Retained<TrayActionRowView> = unsafe {
        let allocated = TrayActionRowView::alloc(mtm);
        msg_send![allocated, initWithFrame: frame]
    };
    view.setWantsLayer(true);
    add_hover_background(&view, NODE_MENU_WIDTH, ACTION_ROW_HEIGHT, mtm);
    let label = NSTextField::labelWithString(&NSString::new(), mtm);
    label.setTag(ACTION_ROW_VIEW_LABEL_TAG);
    label.setFrame(objc2_foundation::NSRect::new(
        objc2_foundation::NSPoint::new(18.0, 0.0),
        objc2_foundation::NSSize::new(NODE_MENU_WIDTH - 36.0, ACTION_ROW_HEIGHT),
    ));
    label.setFont(Some(&NSFont::menuBarFontOfSize(13.0)));
    view.addSubview(&label);
    view
}

fn update_action_row_view(view: &TrayActionRowView, text: &str, enabled: bool, menu_width: f64) {
    let Some(label) = view
        .viewWithTag(ACTION_ROW_VIEW_LABEL_TAG)
        .and_then(|view| view.downcast::<NSTextField>().ok())
    else {
        return;
    };
    set_menu_label_text(&label, text);
    let color = if enabled {
        NSColor::labelColor()
    } else {
        NSColor::disabledControlTextColor()
    };
    label.setTextColor(Some(&color));
    label.setFrame(objc2_foundation::NSRect::new(
        objc2_foundation::NSPoint::new(18.0, 0.0),
        objc2_foundation::NSSize::new((menu_width - 36.0).max(100.0), ACTION_ROW_HEIGHT),
    ));
    resize_hover_background(view, menu_width, ACTION_ROW_HEIGHT);
}

define_class!(
    #[unsafe(super(NSView))]
    #[name = "CrossbowTraySubmenuRowView"]
    #[thread_kind = MainThreadOnly]
    struct TraySubmenuRowView;

    unsafe impl NSObjectProtocol for TraySubmenuRowView {}

    impl TraySubmenuRowView {
        #[unsafe(method(updateTrackingAreas))]
        fn update_tracking_areas(&self) {
            unsafe {
                let _: () = msg_send![super(self), updateTrackingAreas];
            }
            install_hover_tracking(self);
        }

        #[unsafe(method(mouseEntered:))]
        fn on_mouse_entered(&self, _event: &NSEvent) {
            set_row_hovered(self, true, &[SUBMENU_ROW_LABEL_TAG, SUBMENU_ROW_CHEVRON_TAG]);
        }

        #[unsafe(method(mouseExited:))]
        fn on_mouse_exited(&self, _event: &NSEvent) {
            set_row_hovered(self, false, &[SUBMENU_ROW_LABEL_TAG, SUBMENU_ROW_CHEVRON_TAG]);
        }
    }
);

fn make_submenu_row_view(mtm: MainThreadMarker) -> Retained<TraySubmenuRowView> {
    let frame = objc2_foundation::NSRect::new(
        objc2_foundation::NSPoint::new(0.0, 0.0),
        objc2_foundation::NSSize::new(NODE_MENU_WIDTH, SUBMENU_ROW_HEIGHT),
    );
    let view: Retained<TraySubmenuRowView> = unsafe {
        let allocated = TraySubmenuRowView::alloc(mtm);
        msg_send![allocated, initWithFrame: frame]
    };
    view.setWantsLayer(true);
    add_hover_background(&view, NODE_MENU_WIDTH, SUBMENU_ROW_HEIGHT, mtm);
    let title = NSTextField::labelWithString(&NSString::new(), mtm);
    title.setTag(SUBMENU_ROW_LABEL_TAG);
    title.setFont(Some(&NSFont::menuBarFontOfSize(12.5)));
    title.setLineBreakMode(NSLineBreakMode::ByTruncatingTail);
    let chevron = NSTextField::labelWithString(&NSString::from_str("›"), mtm);
    chevron.setTag(SUBMENU_ROW_CHEVRON_TAG);
    chevron.setAlignment(NSTextAlignment::Center);
    chevron.setFont(Some(&NSFont::menuBarFontOfSize(16.0)));
    set_menu_label_text(&chevron, "›");
    view.addSubview(&title);
    view.addSubview(&chevron);
    view
}

fn update_submenu_row_view(view: &TraySubmenuRowView, text: &str, menu_width: f64) {
    view.setFrame(objc2_foundation::NSRect::new(
        objc2_foundation::NSPoint::new(0.0, 0.0),
        objc2_foundation::NSSize::new(menu_width, SUBMENU_ROW_HEIGHT),
    ));
    resize_hover_background(view, menu_width, SUBMENU_ROW_HEIGHT);
    if let Some(title) = view
        .viewWithTag(SUBMENU_ROW_LABEL_TAG)
        .and_then(|view| view.downcast::<NSTextField>().ok())
    {
        set_menu_label_text(&title, text);
        title.setFrame(objc2_foundation::NSRect::new(
            objc2_foundation::NSPoint::new(18.0, 0.0),
            objc2_foundation::NSSize::new((menu_width - 47.0).max(80.0), SUBMENU_ROW_HEIGHT),
        ));
    }
    if let Some(chevron) = view
        .viewWithTag(SUBMENU_ROW_CHEVRON_TAG)
        .and_then(|view| view.downcast::<NSTextField>().ok())
    {
        chevron.setFrame(objc2_foundation::NSRect::new(
            objc2_foundation::NSPoint::new(menu_width - 26.0, 0.0),
            objc2_foundation::NSSize::new(18.0, SUBMENU_ROW_HEIGHT),
        ));
    }
}

fn make_node_row_view(mtm: MainThreadMarker) -> Retained<TrayNodeRowView> {
    let frame = objc2_foundation::NSRect::new(
        objc2_foundation::NSPoint::new(0.0, 0.0),
        objc2_foundation::NSSize::new(NODE_MENU_WIDTH, NODE_ROW_HEIGHT),
    );
    let view: Retained<TrayNodeRowView> = unsafe {
        let allocated = TrayNodeRowView::alloc(mtm);
        msg_send![allocated, initWithFrame: frame]
    };
    view.setWantsLayer(true);
    add_hover_background(&view, NODE_MENU_WIDTH, NODE_ROW_HEIGHT, mtm);

    let check = NSTextField::labelWithString(&NSString::from_str("✓"), mtm);
    check.setTag(ROW_VIEW_CHECK_TAG);
    check.setFrame(objc2_foundation::NSRect::new(
        objc2_foundation::NSPoint::new(4.0, 0.0),
        objc2_foundation::NSSize::new(16.0, NODE_ROW_HEIGHT),
    ));
    check.setFont(Some(&NSFont::menuBarFontOfSize(12.0)));
    check.setAlignment(NSTextAlignment::Center);

    let name = NSTextField::labelWithString(&NSString::new(), mtm);
    name.setTag(ROW_VIEW_NAME_TAG);
    name.setFrame(objc2_foundation::NSRect::new(
        objc2_foundation::NSPoint::new(25.0, 0.0),
        objc2_foundation::NSSize::new(220.0, NODE_ROW_HEIGHT),
    ));
    name.setFont(Some(&NSFont::menuBarFontOfSize(12.5)));
    name.setLineBreakMode(NSLineBreakMode::ByTruncatingTail);

    let badge = NSTextField::labelWithString(&NSString::new(), mtm);
    badge.setTag(ROW_VIEW_BADGE_TAG);
    badge.setAlignment(NSTextAlignment::Center);
    let badge_font =
        unsafe { NSFont::monospacedDigitSystemFontOfSize_weight(9.0, NSFontWeightRegular) };
    badge.setFont(Some(&badge_font));
    badge.setTextColor(Some(&NSColor::whiteColor()));
    badge.setWantsLayer(true);
    if let Some(layer) = layer_for(&badge) {
        unsafe {
            let _: () = msg_send![&*layer, setCornerRadius: 3.0f64];
            let _: () = msg_send![&*layer, setMasksToBounds: true];
        }
    }

    view.addSubview(&check);
    view.addSubview(&name);
    view.addSubview(&badge);
    view
}

fn update_node_row_view(
    view: &TrayNodeRowView,
    row: &TrayNodeRow,
    ms: Option<u64>,
    menu_width: f64,
    mtm: MainThreadMarker,
) {
    let Some(name) = view
        .viewWithTag(ROW_VIEW_NAME_TAG)
        .and_then(|view| view.downcast::<NSTextField>().ok())
    else {
        return;
    };
    let Some(check) = view
        .viewWithTag(ROW_VIEW_CHECK_TAG)
        .and_then(|view| view.downcast::<NSTextField>().ok())
    else {
        return;
    };
    let Some(badge) = view
        .viewWithTag(ROW_VIEW_BADGE_TAG)
        .and_then(|view| view.downcast::<NSTextField>().ok())
    else {
        return;
    };

    let badge_width = (display_width(&row.badge) as f64 * 6.0 + 14.0).max(30.0);
    let badge_x = menu_width - badge_width - 10.0;
    let name_width = (badge_x - 34.0).max(50.0);
    let display_name = truncate_display_name(&row.name, name_width);
    set_menu_label_text(&name, &display_name);
    name.setToolTip(Some(&NSString::from_str(&row.name)));
    set_menu_label_text(&check, if row.selected { "✓" } else { "" });
    name.setFrame(objc2_foundation::NSRect::new(
        objc2_foundation::NSPoint::new(25.0, 0.0),
        objc2_foundation::NSSize::new(name_width, NODE_ROW_HEIGHT),
    ));
    badge.setFrame(objc2_foundation::NSRect::new(
        objc2_foundation::NSPoint::new(badge_x, 2.5),
        objc2_foundation::NSSize::new(badge_width, 18.0),
    ));
    badge.setAlignment(NSTextAlignment::Center);
    set_menu_label_text(&badge, &row.badge);
    let color = delay_color(ms, &row.badge);
    if let Some(layer) = layer_for(&badge) {
        let cg_color = color.CGColor();
        unsafe {
            let _: () = msg_send![&*layer, setBackgroundColor: &*cg_color];
            let _: () = msg_send![&*layer, setCornerRadius: 3.0f64];
            let _: () = msg_send![&*layer, setMasksToBounds: true];
        }
    }
    let _ = mtm;
}

fn install_hover_tracking(view: &NSView) {
    unsafe {
        for area in view.trackingAreas() {
            view.removeTrackingArea(&area);
        }
        let options = NSTrackingAreaOptions::MouseEnteredAndExited
            | NSTrackingAreaOptions::ActiveAlways
            | NSTrackingAreaOptions::InVisibleRect;
        let rect = objc2_foundation::NSRect::new(
            objc2_foundation::NSPoint::new(0.0, 0.0),
            objc2_foundation::NSSize::new(0.0, 0.0),
        );
        let area = NSTrackingArea::initWithRect_options_owner_userInfo(
            NSTrackingArea::alloc(),
            rect,
            options,
            Some(view),
            None,
        );
        view.addTrackingArea(&area);
    }
}

fn add_hover_background(view: &NSView, width: f64, height: f64, mtm: MainThreadMarker) {
    let frame = objc2_foundation::NSRect::new(
        objc2_foundation::NSPoint::new(HOVER_HORIZONTAL_INSET, 0.0),
        objc2_foundation::NSSize::new(
            (width - HOVER_HORIZONTAL_INSET * 2.0).max(0.0),
            height,
        ),
    );
    let background: Retained<NSView> = unsafe {
        let allocated = NSView::alloc(mtm);
        msg_send![allocated, initWithFrame: frame]
    };
    background.setWantsLayer(true);
    view.addSubview(&background);
}

fn hover_background(view: &NSView) -> Option<Retained<NSView>> {
    view.subviews().firstObject()?.downcast::<NSView>().ok()
}

fn resize_hover_background(view: &NSView, width: f64, height: f64) {
    if let Some(background) = hover_background(view) {
        background.setFrame(objc2_foundation::NSRect::new(
            objc2_foundation::NSPoint::new(HOVER_HORIZONTAL_INSET, 0.0),
            objc2_foundation::NSSize::new(
                (width - HOVER_HORIZONTAL_INSET * 2.0).max(0.0),
                height,
            ),
        ));
    }
}

fn set_row_hovered(view: &NSView, hovered: bool, label_tags: &[isize]) {
    let Some(background_view) = hover_background(view) else {
        return;
    };
    let Some(layer) = layer_for(&background_view) else {
        return;
    };
    let background = if hovered {
        NSColor::selectedContentBackgroundColor()
    } else {
        NSColor::clearColor()
    };
    let cg_color = background.CGColor();
    unsafe {
        let _: () = msg_send![&*layer, setBackgroundColor: &*cg_color];
        let _: () = msg_send![&*layer, setCornerRadius: HOVER_CORNER_RADIUS];
        let _: () = msg_send![&*layer, setMasksToBounds: true];
    }
    let text_color = if hovered {
        NSColor::whiteColor()
    } else {
        NSColor::labelColor()
    };
    for tag in label_tags {
        if let Some(label) = view
            .viewWithTag(*tag)
            .and_then(|view| view.downcast::<NSTextField>().ok())
        {
            label.setTextColor(Some(&text_color));
        }
    }
}

fn set_action_row_hovered(view: &TrayActionRowView, hovered: bool) {
    let enabled = view
        .enclosingMenuItem()
        .is_some_and(|item| item.isEnabled());
    set_row_hovered(
        view,
        hovered && enabled,
        &[ACTION_ROW_VIEW_LABEL_TAG],
    );
    if !enabled {
        if let Some(label) = view
            .viewWithTag(ACTION_ROW_VIEW_LABEL_TAG)
            .and_then(|view| view.downcast::<NSTextField>().ok())
        {
            label.setTextColor(Some(&NSColor::disabledControlTextColor()));
        }
    }
}

fn layer_for(view: &NSView) -> Option<Retained<AnyObject>> {
    unsafe { msg_send![view, layer] }
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "CrossbowTrayMenuObserver"]
    #[thread_kind = MainThreadOnly]
    #[ivars = AppHandle]
    struct TrayMenuObserver;

    unsafe impl NSObjectProtocol for TrayMenuObserver {}

    impl TrayMenuObserver {
        #[unsafe(method(menuDidBeginTracking:))]
        fn menu_did_begin_tracking(&self, notification: &NSNotification) {
            let Some(menu) = notification
                .object()
                .and_then(|object| object.downcast::<NSMenu>().ok())
            else {
                return;
            };
            if !contains_delay_test(&menu) {
                return;
            }
            let handle = self.ivars();
            let Some(state) = handle.try_state::<crate::AppState>() else {
                return;
            };
            let lang = state.store.lock().unwrap().data().ui.lang.clone();
            let data = state.node_menu.lock().unwrap().snapshot(&crate::tr(
                &lang,
                "节点选择",
                "Nodes",
            ));
            let (menu_width, badge_tab) = node_menu_layout(&data.rows);
            update_menu_items(&menu, &data.rows, data.testing, menu_width, badge_tab);
        }
    }
);

/// Install rows at the beginning of AppKit menu tracking. Tauri temporarily
/// assigns the menu to NSStatusItem only while tracking, so refreshing it while
/// closed cannot reach the menu; this notification runs before the first rows
/// are displayed and keeps custom badges/actions ready on every opening.
pub fn install_menu_observer(handle: &AppHandle) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let observer = TrayMenuObserver::alloc(mtm).set_ivars(handle.clone());
    let observer: Retained<TrayMenuObserver> = unsafe { msg_send![super(observer), init] };
    let center = NSNotificationCenter::defaultCenter();
    unsafe {
        center.addObserver_selector_name_object(
            &*observer,
            objc2::sel!(menuDidBeginTracking:),
            Some(NSMenuDidBeginTrackingNotification),
            None,
        );
    }
    MENU_OBSERVER.with(|current| *current.borrow_mut() = Some(observer));
}

pub fn display_name(name: &str) -> String {
    truncate_display_name(name, 202.0)
}

fn truncate_display_name(name: &str, max_width: f64) -> String {
    let width = |text: &str| display_width(text) as f64 * 7.1;
    if width(name) <= max_width {
        return name.to_string();
    }

    let mut out = String::new();
    for ch in name.chars() {
        let next = format!("{out}{ch}…");
        if width(&next) > max_width {
            break;
        }
        out.push(ch);
    }
    out.push('…');
    out
}

// 原地更新托盘菜单的节点行（不重建菜单，菜单打开时可见实时变化）。
pub fn update_node_items(handle: &AppHandle, rows: &[TrayNodeRow], testing: bool) {
    let state = handle.state::<crate::AppState>();
    let tray = state.tray.lock().unwrap().clone();
    let Some(tray) = tray else { return };
    let rows_owned: Vec<TrayNodeRow> = rows.to_vec();
    let testing_owned = testing;
    let _ = tray.with_inner_tray_icon(move |inner| {
        let Some(status_item) = inner.ns_status_item() else {
            return;
        };
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Some(menu) = status_item.menu(mtm) else {
            return;
        };
        let (menu_width, badge_tab) = node_menu_layout(&rows_owned);
        update_menu_items(&menu, &rows_owned, testing_owned, menu_width, badge_tab);
    });
}

fn is_delay_test_item(item: &NSMenuItem) -> bool {
    matches!(
        item.title().to_string().as_str(),
        "延迟测速" | "延迟测速中…" | "Test latency" | "Testing latency…"
    )
}

fn contains_delay_test(menu: &NSMenu) -> bool {
    (0..menu.numberOfItems()).any(|index| {
        menu.itemAtIndex(index).is_some_and(|item| {
            is_delay_test_item(&item)
                || item
                    .submenu()
                    .is_some_and(|submenu| contains_delay_test(&submenu))
        })
    })
}

fn node_menu_layout(_rows: &[TrayNodeRow]) -> (f64, f64) {
    // Fixed menu width and right edge for the badge column. Long node names are
    // truncated to keep this width stable after every benchmark result.
    (NODE_MENU_WIDTH, NODE_MENU_WIDTH - 30.0)
}

fn update_menu_items(
    menu: &NSMenu,
    rows: &[TrayNodeRow],
    testing: bool,
    menu_width: f64,
    badge_tab: f64,
) {
    let is_node_menu = (0..menu.numberOfItems())
        .any(|index| menu.itemAtIndex(index).is_some_and(|item| is_delay_test_item(&item)));
    if is_node_menu {
        menu.setMinimumWidth(menu_width);
    }

    let mut row_index = 0;
    for index in 0..menu.numberOfItems() {
        let Some(item) = menu.itemAtIndex(index) else {
            continue;
        };
        let title = item.title().to_string();
        if is_delay_test_item(&item) {
            let chinese = title.starts_with("延迟");
            let text = match (testing, chinese) {
                (true, true) => "延迟测速中…",
                (false, true) => "延迟测速",
                (true, false) => "Testing latency…",
                (false, false) => "Test latency",
            };
            item.setTitle(&NSString::from_str(text));
            item.setEnabled(!testing);
            let mtm = MainThreadMarker::new().expect("tray menu updates run on the main thread");
            let row_view = item
                .view()
                .and_then(|view| view.downcast::<TrayActionRowView>().ok())
                .unwrap_or_else(|| make_action_row_view(mtm));
            update_action_row_view(&row_view, text, !testing, menu_width);
            item.setView(Some(&row_view));
        } else if is_node_menu && !title.is_empty() {
            let represented_name = item
                .representedObject()
                .and_then(|value| value.downcast::<NSString>().ok())
                .map(|value| value.to_string());
            let row = represented_name
                .as_deref()
                .and_then(|name| rows.iter().find(|row| row.name == name))
                .or_else(|| rows.get(row_index));
            row_index += 1;
            if let Some(row) = row {
                unsafe {
                    item.setRepresentedObject(Some(&NSString::from_str(&row.name)));
                }
                let mtm =
                    MainThreadMarker::new().expect("tray menu updates run on the main thread");
                let row_view = item
                    .view()
                    .and_then(|view| view.downcast::<TrayNodeRowView>().ok())
                    .unwrap_or_else(|| make_node_row_view(mtm));
                update_node_row_view(&row_view, row, row.ms, menu_width, mtm);
                item.setView(Some(&row_view));
                item.setState(if row.selected { 1 } else { 0 });
            }
        }

        if let Some(submenu) = item.submenu() {
            if contains_delay_test(&submenu) {
                let mtm =
                    MainThreadMarker::new().expect("tray menu updates run on the main thread");
                let row_view = item
                    .view()
                    .and_then(|view| view.downcast::<TraySubmenuRowView>().ok())
                    .unwrap_or_else(|| make_submenu_row_view(mtm));
                update_submenu_row_view(&row_view, &title, menu.size().width);
                item.setView(Some(&row_view));
            }
            update_menu_items(&submenu, rows, testing, menu_width, badge_tab);
        }
    }
}
