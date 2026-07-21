import AppKit
import Foundation
import SwiftUI

let openDeskArguments = Array(CommandLine.arguments.dropFirst())

if openDeskArguments.first?.hasPrefix("-") == true {
    exit(OpenDeskCLI.run(openDeskArguments))
} else {
    UserDefaults.standard.set(true, forKey: "ApplePersistenceIgnoreState")
    let savedStateURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Saved Application State/tw.opendesk.desktop.savedState", isDirectory: true)
    try? FileManager.default.removeItem(at: savedStateURL)
    OpenDeskTWApp.main()
}
