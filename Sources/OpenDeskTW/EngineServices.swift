import AppKit
import Foundation

struct EngineLocator {
    static let onlyOfficeURL = URL(fileURLWithPath: "/Applications/ONLYOFFICE.app", isDirectory: true)
    static let libreOfficeURL = URL(fileURLWithPath: "/Applications/LibreOffice.app", isDirectory: true)

    static func appURL(for engine: OfficeEngine) -> URL {
        switch engine {
        case .onlyOffice: return onlyOfficeURL
        case .libreOffice: return libreOfficeURL
        }
    }

    static func executableURL(for engine: OfficeEngine) -> URL {
        switch engine {
        case .onlyOffice:
            return onlyOfficeURL.appendingPathComponent("Contents/MacOS/ONLYOFFICE")
        case .libreOffice:
            return libreOfficeURL.appendingPathComponent("Contents/MacOS/soffice")
        }
    }

    static func status(for engine: OfficeEngine) -> EngineStatus {
        let appURL = appURL(for: engine)
        let installed = FileManager.default.fileExists(atPath: appURL.path)
        var version: String?
        if installed,
           let bundle = Bundle(url: appURL) {
            version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        }
        return EngineStatus(
            engine: engine,
            installed: installed,
            appPath: installed ? appURL.path : nil,
            version: version
        )
    }

    static func allStatuses() -> [EngineStatus] {
        OfficeEngine.allCases.map(status(for:))
    }
}

enum DocumentRouter {
    private static let textExtensions: Set<String> = ["docx", "docm"]
    private static let spreadsheetExtensions: Set<String> = ["xlsx", "xlsm"]
    private static let presentationExtensions: Set<String> = ["pptx", "pptm"]
    private static let legacyExtensions: Set<String> = ["doc", "xls", "ppt", "rtf"]
    private static let openDocumentExtensions: Set<String> = ["odt", "ods", "odp", "fodt", "fods", "fodp", "csv"]

    static func kind(for fileExtension: String) -> DocumentKind {
        let ext = fileExtension.lowercased()
        if textExtensions.contains(ext) { return .text }
        if spreadsheetExtensions.contains(ext) { return .spreadsheet }
        if presentationExtensions.contains(ext) { return .presentation }
        if ext == "pdf" { return .pdf }
        if legacyExtensions.contains(ext) { return .legacy }
        if openDocumentExtensions.contains(ext) { return .openDocument }
        return .unknown
    }

    static func preferredEngine(for fileExtension: String) -> OfficeEngine {
        switch kind(for: fileExtension) {
        case .text, .spreadsheet, .presentation, .pdf:
            return .onlyOffice
        case .openDocument, .legacy, .unknown:
            return .libreOffice
        }
    }
}

enum EngineLauncher {
    static func launch(_ engine: OfficeEngine) throws {
        let appURL = EngineLocator.appURL(for: engine)
        guard FileManager.default.fileExists(atPath: appURL.path) else {
            throw OpenDeskError.missingEngine(engine)
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.openApplication(at: appURL, configuration: configuration) { _, error in
            if let error {
                NSLog("OpenDesk TW engine launch failed: %@", error.localizedDescription)
            }
        }
    }

    static func open(_ documentURL: URL, using engine: OfficeEngine) throws {
        let appURL = EngineLocator.appURL(for: engine)
        guard FileManager.default.fileExists(atPath: appURL.path) else {
            throw OpenDeskError.missingEngine(engine)
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.open(
            [documentURL],
            withApplicationAt: appURL,
            configuration: configuration
        ) { _, error in
            if let error {
                NSLog("OpenDesk TW document open failed: %@", error.localizedDescription)
            }
        }
    }
}
