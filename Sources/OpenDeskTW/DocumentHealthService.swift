import Foundation

enum DocumentHealthOutcome: String, Codable {
    case passed
    case attention
    case protected

    var displayName: String {
        switch self {
        case .passed: return "通過"
        case .attention: return "需確認"
        case .protected: return "安全保護"
        }
    }
}

struct DocumentHealthVerdict: Identifiable, Codable {
    let id: String
    let title: String
    let outcome: DocumentHealthOutcome
    let detail: String
}

struct DocumentHealthReport: Codable {
    let verdicts: [DocumentHealthVerdict]
    let conclusion: String

    static func evaluate(_ analysis: DocumentAnalysis) -> DocumentHealthReport {
        let structure: DocumentHealthVerdict
        let isOOXML = ["docx", "docm", "xlsx", "xlsm", "pptx", "pptm"].contains(analysis.fileExtension)
        if isOOXML && analysis.packageEntriesInspected == 0 {
            structure = DocumentHealthVerdict(
                id: "structure",
                title: "文件結構",
                outcome: .attention,
                detail: "無法完整讀取文件套件，建議先用救援引擎另存副本。"
            )
        } else {
            structure = DocumentHealthVerdict(
                id: "structure",
                title: "文件結構",
                outcome: .passed,
                detail: isOOXML
                    ? "已檢查 \(analysis.packageEntriesInspected) 個文件套件項目。"
                    : "檔案類型與路由規則有效。"
            )
        }

        let typography: DocumentHealthVerdict
        if !analysis.missingFonts.isEmpty {
            typography = DocumentHealthVerdict(
                id: "typography",
                title: "字型排版",
                outcome: .attention,
                detail: "缺少 \(analysis.missingFonts.count) 種字型，開啟後請先核對換行與頁數。"
            )
        } else if !analysis.fontSubstitutions.isEmpty {
            typography = DocumentHealthVerdict(
                id: "typography",
                title: "字型排版",
                outcome: .passed,
                detail: "已準備 \(analysis.fontSubstitutions.count) 組開源相容字型替代。"
            )
        } else {
            typography = DocumentHealthVerdict(
                id: "typography",
                title: "字型排版",
                outcome: .passed,
                detail: "未發現缺少字型或靜默替代。"
            )
        }

        let safety: DocumentHealthVerdict
        switch analysis.riskLevel {
        case .high:
            safety = DocumentHealthVerdict(
                id: "safety",
                title: "安全與備份",
                outcome: .protected,
                detail: "偵測到高風險功能，將以唯讀安全副本開啟並保留原檔。"
            )
        case .attention:
            safety = DocumentHealthVerdict(
                id: "safety",
                title: "安全與備份",
                outcome: .attention,
                detail: "可開啟，但需人工核對警示項目；仍會先建立版本備份。"
            )
        case .normal:
            safety = DocumentHealthVerdict(
                id: "safety",
                title: "安全與備份",
                outcome: .passed,
                detail: "未偵測到高風險功能，開啟前仍會建立版本備份。"
            )
        }

        let verdicts = [structure, typography, safety]
        let conclusion: String
        if verdicts.contains(where: { $0.outcome == .protected }) {
            conclusion = "保護模式：請使用唯讀安全副本"
        } else if verdicts.contains(where: { $0.outcome == .attention }) {
            conclusion = "有條件通過：開啟後請人工核對"
        } else {
            conclusion = "三項一致通過：可以進入編輯流程"
        }
        return DocumentHealthReport(verdicts: verdicts, conclusion: conclusion)
    }
}
