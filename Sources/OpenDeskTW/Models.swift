import Foundation

enum OfficeEngine: String, Codable, CaseIterable, Identifiable {
    case onlyOffice
    case libreOffice

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .onlyOffice: return "ONLYOFFICE"
        case .libreOffice: return "LibreOffice"
        }
    }

    var roleDescription: String {
        switch self {
        case .onlyOffice: return "Office 相容前台"
        case .libreOffice: return "轉檔與救援後台"
        }
    }
}

enum DocumentKind: String, Codable {
    case text
    case spreadsheet
    case presentation
    case pdf
    case openDocument
    case legacy
    case unknown

    var displayName: String {
        switch self {
        case .text: return "文字文件"
        case .spreadsheet: return "試算表"
        case .presentation: return "簡報"
        case .pdf: return "PDF"
        case .openDocument: return "開放文件格式"
        case .legacy: return "舊版 Office 格式"
        case .unknown: return "其他文件"
        }
    }
}

enum NewDocumentType: String, CaseIterable, Identifiable, Codable {
    case text
    case spreadsheet
    case presentation

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .text: return "文字文件"
        case .spreadsheet: return "試算表"
        case .presentation: return "簡報"
        }
    }

    var actionTitle: String { "新增\(displayName)" }

    var fileExtension: String {
        switch self {
        case .text: return "docx"
        case .spreadsheet: return "xlsx"
        case .presentation: return "pptx"
        }
    }

    var suggestedFileName: String {
        switch self {
        case .text: return "未命名文字文件.docx"
        case .spreadsheet: return "未命名試算表.xlsx"
        case .presentation: return "未命名簡報.pptx"
        }
    }

    var templateBaseName: String {
        switch self {
        case .text: return "Blank-Document"
        case .spreadsheet: return "Blank-Spreadsheet"
        case .presentation: return "Blank-Presentation"
        }
    }

    var iconName: String {
        switch self {
        case .text: return "doc.text.fill"
        case .spreadsheet: return "tablecells.fill"
        case .presentation: return "rectangle.on.rectangle.angled"
        }
    }

    var documentKind: DocumentKind {
        switch self {
        case .text: return .text
        case .spreadsheet: return .spreadsheet
        case .presentation: return .presentation
        }
    }

    init?(commandLineValue: String) {
        switch commandLineValue.lowercased() {
        case "text", "document", "docx": self = .text
        case "spreadsheet", "sheet", "xlsx": self = .spreadsheet
        case "presentation", "slides", "pptx": self = .presentation
        default: return nil
        }
    }
}

struct RecentDocumentRecord: Identifiable, Codable, Hashable {
    let path: String
    let kind: DocumentKind
    let lastOpened: Date

    var id: String { path }
    var url: URL { URL(fileURLWithPath: path) }
    var fileName: String { url.lastPathComponent }
    var folderName: String { url.deletingLastPathComponent().lastPathComponent }
}

enum RiskLevel: Int, Codable, Comparable {
    case normal = 0
    case attention = 1
    case high = 2

    static func < (lhs: RiskLevel, rhs: RiskLevel) -> Bool {
        lhs.rawValue < rhs.rawValue
    }

    var displayName: String {
        switch self {
        case .normal: return "一般"
        case .attention: return "需留意"
        case .high: return "高風險"
        }
    }
}

struct CompatibilityIssue: Identifiable, Codable, Hashable {
    let id: UUID
    let level: RiskLevel
    let title: String
    let detail: String

    init(level: RiskLevel, title: String, detail: String) {
        self.id = UUID()
        self.level = level
        self.title = title
        self.detail = detail
    }
}

struct DetectedHeading: Identifiable, Codable, Hashable {
    let paragraphNumber: Int
    let level: Int
    let prefix: String
    let text: String

    var id: String { "\(paragraphNumber)-\(level)-\(prefix)" }
}

struct DocumentAnalysis: Codable {
    let fileName: String
    let filePath: String
    let fileExtension: String
    let fileSize: Int64
    let kind: DocumentKind
    let preferredEngine: OfficeEngine
    let alternateEngine: OfficeEngine
    let riskLevel: RiskLevel
    let issues: [CompatibilityIssue]
    let detectedFonts: [String]
    let missingFonts: [String]
    let fontSubstitutions: [String: String]
    let packageEntriesInspected: Int
    let detectedHeadings: [DetectedHeading]

    var humanSize: String {
        ByteCountFormatter.string(fromByteCount: fileSize, countStyle: .file)
    }
}

struct EngineStatus: Identifiable, Codable {
    let engine: OfficeEngine
    let installed: Bool
    let appPath: String?
    let version: String?

    var id: String { engine.rawValue }
}

enum OpenDeskError: LocalizedError {
    case missingEngine(OfficeEngine)
    case unsupportedPDFSource
    case processFailed(command: String, code: Int32, message: String)
    case outputMissing(String)
    case invalidFile(String)

    var errorDescription: String? {
        switch self {
        case .missingEngine(let engine):
            return "找不到 \(engine.displayName)，請先完成引擎安裝。"
        case .unsupportedPDFSource:
            return "PDF 已是輸出格式，請選擇 Office 或 OpenDocument 文件。"
        case .processFailed(let command, let code, let message):
            return "執行失敗（\(command)，代碼 \(code)）：\(message)"
        case .outputMissing(let path):
            return "轉換程序結束，但找不到輸出檔：\(path)"
        case .invalidFile(let message):
            return message
        }
    }
}
