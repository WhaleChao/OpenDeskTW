import SwiftUI

struct OpenDeskTWApp: App {
    @NSApplicationDelegateAdaptor(OpenDeskAppDelegate.self) private var appDelegate

    private var model: AppModel { appDelegate.model }

    var body: some Scene {
        WindowGroup("OpenDesk TW") {
            ContentView()
                .environmentObject(model)
                .frame(minWidth: 980, minHeight: 680)
        }
        .defaultSize(width: 1120, height: 760)
        .windowStyle(.titleBar)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("新增文字文件") {
                    model.createDocument(.text)
                }
                .keyboardShortcut("n")
                Button("新增試算表") {
                    model.createDocument(.spreadsheet)
                }
                .keyboardShortcut("n", modifiers: [.command, .shift])
                Button("新增簡報") {
                    model.createDocument(.presentation)
                }
                .keyboardShortcut("n", modifiers: [.command, .option])
                Divider()
                Button("開啟文件…") {
                    NotificationCenter.default.post(name: .openDeskRequestOpen, object: nil)
                }
                .keyboardShortcut("o")
                Divider()
                Button("開啟 Office 相容編輯器") { model.launchEngine(.onlyOffice) }
                Button("開啟救援引擎") { model.launchEngine(.libreOffice) }
            }
            CommandMenu("格式與編號") {
                Button("整理中文標題並重新編號") {
                    model.renumberChineseHeadings()
                }
                .keyboardShortcut("r", modifiers: [.command, .option])
                .disabled(model.analysis?.detectedHeadings.isEmpty != false || model.isWorking)
                Divider()
                Text("編輯器：⌘B 粗體、⌘I 斜體、⌘U 底線")
            }
            CommandMenu("MAGI") {
                Button("直接完整分析目前文件") {
                    model.analyzeSelectedWithMAGI(mode: .complete)
                }
                .keyboardShortcut("m", modifiers: [.command, .option])
                .disabled(model.analysis == nil || model.isAnalyzingWithMAGI || model.magiStatus?.agentAvailable != true)
                Button("開啟 MAGI 網頁主控台") {
                    model.openMAGIConsole()
                }
                Divider()
                Text("分析結果會顯示在 OpenDesk TW 內")
            }
        }

        Settings {
            SettingsView()
                .environmentObject(model)
                .frame(width: 620, height: 430)
        }
    }
}

extension Notification.Name {
    static let openDeskRequestOpen = Notification.Name("OpenDeskTW.RequestOpen")
    static let openDeskReceivedDocument = Notification.Name("OpenDeskTW.ReceivedDocument")
}
