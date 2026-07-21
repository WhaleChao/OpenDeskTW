import AppKit
import SwiftUI

@MainActor
final class OpenDeskAppDelegate: NSObject, NSApplicationDelegate {
    let model = AppModel()
    private var fallbackWindow: NSWindow?
    private var pendingDocumentURL: URL?

    func applicationShouldSaveSecureApplicationState(_ app: NSApplication) -> Bool {
        false
    }

    func applicationShouldRestoreSecureApplicationState(_ app: NSApplication) -> Bool {
        false
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSLog("OpenDesk TW：啟動完成，準備主視窗")
        restoreMainWindow()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            self.restoreMainWindow()
            self.deliverPendingDocument()
        }
    }

    func application(
        _ app: NSApplication,
        shouldRestoreWindowWithIdentifier identifier: NSUserInterfaceItemIdentifier,
        state: NSCoder,
        completionHandler: @escaping (NSWindow?, Error?) -> Void
    ) -> Bool {
        false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        restoreMainWindow()
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        guard let documentURL = urls.first else { return }
        pendingDocumentURL = documentURL
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            self.restoreMainWindow()
            self.deliverPendingDocument()
        }
    }

    private func restoreMainWindow() {
        guard let screen = NSScreen.main ?? NSScreen.screens.first else {
            NSLog("OpenDesk TW：找不到可用螢幕")
            return
        }
        var windows = NSApp.windows.filter {
            $0.styleMask.contains(.titled) && !($0 is NSPanel) && $0.isVisible
        }
        NSLog("OpenDesk TW：視窗總數 %d，可見主視窗 %d", NSApp.windows.count, windows.count)
        if windows.isEmpty {
            NSLog("OpenDesk TW：建立原生備援主視窗")
            let rootView = ContentView()
                .environmentObject(model)
                .frame(minWidth: 980, minHeight: 680)
            let controller = NSHostingController(rootView: rootView)
            let window = NSWindow(contentViewController: controller)
            window.title = "OpenDesk TW"
            window.identifier = NSUserInterfaceItemIdentifier("OpenDeskTW.MainWindow")
            window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
            window.isReleasedWhenClosed = false
            window.setContentSize(NSSize(width: 1120, height: 760))
            fallbackWindow = window
            windows = [window]
        }
        let visible = screen.visibleFrame
        let size = NSSize(width: min(1120, visible.width), height: min(760, visible.height))
        let origin = NSPoint(
            x: visible.midX - size.width / 2,
            y: visible.midY - size.height / 2
        )
        for window in windows {
            window.setFrame(NSRect(origin: origin, size: size), display: true)
            window.makeKeyAndOrderFront(nil)
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    private func deliverPendingDocument() {
        guard let documentURL = pendingDocumentURL else { return }
        pendingDocumentURL = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            NotificationCenter.default.post(
                name: .openDeskReceivedDocument,
                object: nil,
                userInfo: ["url": documentURL]
            )
        }
    }
}
