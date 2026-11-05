// Standalone local preview. It imports no Crossbow code, opens no network sockets,
// and never reads or writes application configuration.
import AppKit

@MainActor
final class PreviewDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let iconURL = Bundle.main.url(forResource: "dock-icon", withExtension: "icns"),
              let iconData = try? Data(contentsOf: iconURL),
              let icon = NSImage(data: iconData),
              let boardURL = Bundle.main.url(forResource: "comparison", withExtension: "png"),
              let board = NSImage(contentsOf: boardURL) else {
            NSApplication.shared.terminate(nil)
            return
        }
        NSApplication.shared.applicationIconImage = icon
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 840, height: 650),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "Crossbow 主按钮色预览 · #293345"
        window.minSize = NSSize(width: 620, height: 500)
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 840, height: 650))
        let image = NSImageView(frame: NSRect(x: 16, y: 48, width: 808, height: 590))
        image.image = board
        image.imageScaling = .scaleProportionallyUpOrDown
        image.autoresizingMask = [.width, .height]
        content.addSubview(image)
        let hint = NSTextField(labelWithString: "Dock 中新增的是独立预览图标；关闭此窗口即可退出，不影响 Crossbow。")
        hint.alignment = .center
        hint.font = .systemFont(ofSize: 12)
        hint.textColor = .secondaryLabelColor
        hint.frame = NSRect(x: 12, y: 14, width: 816, height: 24)
        hint.autoresizingMask = [.width]
        content.addSubview(hint)
        window.contentView = content
        window.center()
        window.makeKeyAndOrderFront(nil)
        self.window = window
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@main
enum PreviewMain {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "退出主按钮色预览", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menu.addItem(appItem)
        app.mainMenu = menu
        let delegate = PreviewDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) { app.run() }
    }
}
