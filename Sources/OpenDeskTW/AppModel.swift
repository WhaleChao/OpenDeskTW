import AppKit
import Foundation
import SwiftUI
import UniformTypeIdentifiers

@MainActor
final class AppModel: ObservableObject {
    @Published var selectedURL: URL?
    @Published var analysis: DocumentAnalysis?
    @Published var engineStatuses: [EngineStatus] = EngineLocator.allStatuses()
    @Published var isWorking = false
    @Published var statusMessage = "離線就緒"
    @Published var lastBackupURL: URL?
    @Published var lastPDFURL: URL?
    @Published var lastRenumberedURL: URL?
    @Published var documentHealthReport: DocumentHealthReport?
    @Published var magiStatus: MAGIStatusReport?
    @Published var isRefreshingMAGI = false
    @Published var magiAnalysisResult: MAGIDocumentAnalysisResult?
    @Published var magiAnalysisError: String?
    @Published var isAnalyzingWithMAGI = false
    @Published var isDropTargeted = false
    @Published var recentDocuments: [RecentDocumentRecord] = []
    @Published var officeSelfTestReport: OfficeSelfTestReport?
    @Published var isRunningOfficeSelfTest = false

    private let inspector = DocumentInspector()
    private let backupManager = BackupManager()
    private let pdfConverter = PDFConverter()
    private let headingService = ChineseHeadingService()
    private let magiIntegration = MAGIIntegration()
    private let templateService = DocumentTemplateService()
    private let recentStore = RecentDocumentStore()
    private let officeSelfTestService = OfficeSelfTestService()

    init() {
        recentDocuments = recentStore.load()
    }

    func refreshEngineStatuses() {
        engineStatuses = EngineLocator.allStatuses()
    }

    func refreshSystemStatuses() {
        refreshEngineStatuses()
        refreshMAGIStatus()
    }

    func runOfficeSelfTest() {
        guard !isRunningOfficeSelfTest else { return }
        isRunningOfficeSelfTest = true
        statusMessage = "正在執行完整 Office LIVE 自我檢查…"
        DispatchQueue.global(qos: .userInitiated).async { [officeSelfTestService] in
            let result = Result { try officeSelfTestService.run() }
            DispatchQueue.main.async {
                self.isRunningOfficeSelfTest = false
                switch result {
                case .success(let report):
                    self.officeSelfTestReport = report
                    self.statusMessage = report.passed
                        ? "完整 Office 自我檢查通過：\(report.summary)"
                        : "Office 自我檢查發現缺口：\(report.summary)"
                case .failure(let error):
                    self.statusMessage = "Office 自我檢查失敗：\(error.localizedDescription)"
                }
            }
        }
    }

    func revealOfficeSelfTestReport() {
        guard let reportPath = officeSelfTestReport?.reportPath else { return }
        FinderService.reveal(URL(fileURLWithPath: reportPath))
    }

    func refreshMAGIStatus() {
        guard !isRefreshingMAGI else { return }
        isRefreshingMAGI = true
        DispatchQueue.global(qos: .utility).async { [magiIntegration] in
            let report = magiIntegration.status()
            DispatchQueue.main.async {
                self.magiStatus = report
                self.isRefreshingMAGI = false
            }
        }
    }

    func selectDocument(_ url: URL) {
        inspectDocument(url, openAfterInspection: false)
    }

    func openRecentDocument(_ record: RecentDocumentRecord) {
        guard FileManager.default.fileExists(atPath: record.path) else {
            recentDocuments = recentStore.remove(record, from: recentDocuments)
            statusMessage = "這份文件已移動或刪除，已從最近文件移除。"
            return
        }
        inspectDocument(record.url, openAfterInspection: true)
    }

    func removeRecentDocument(_ record: RecentDocumentRecord) {
        recentDocuments = recentStore.remove(record, from: recentDocuments)
        statusMessage = "已從最近文件移除；原始文件未刪除。"
    }

    func revealRecentDocument(_ record: RecentDocumentRecord) {
        guard FileManager.default.fileExists(atPath: record.path) else {
            recentDocuments = recentStore.remove(record, from: recentDocuments)
            statusMessage = "這份文件已移動或刪除，已從最近文件移除。"
            return
        }
        FinderService.reveal(record.url)
    }

    func clearRecentDocuments() {
        recentDocuments = recentStore.clear()
        statusMessage = "最近文件清單已清除；原始文件未刪除。"
    }

    func createDocument(_ type: NewDocumentType) {
        let panel = NSSavePanel()
        panel.title = type.actionTitle
        panel.prompt = "建立"
        panel.nameFieldLabel = "檔案名稱："
        panel.nameFieldStringValue = type.suggestedFileName
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        if let contentType = UTType(filenameExtension: type.fileExtension) {
            panel.allowedContentTypes = [contentType]
        }

        guard panel.runModal() == .OK, let requestedURL = panel.url else {
            statusMessage = "已取消新增\(type.displayName)"
            return
        }
        let destinationURL = requestedURL.pathExtension.isEmpty
            ? requestedURL.appendingPathExtension(type.fileExtension)
            : requestedURL
        do {
            try templateService.createCopy(of: type, at: destinationURL)
            recentDocuments = recentStore.record(destinationURL, kind: type.documentKind, in: recentDocuments)
            statusMessage = "已建立 \(destinationURL.lastPathComponent)，正在開啟編輯器…"
            try EngineLauncher.open(destinationURL, using: .onlyOffice)
            selectDocument(destinationURL)
        } catch {
            statusMessage = "新增\(type.displayName)失敗：\(error.localizedDescription)"
        }
    }

    func revealSelectedDocument() {
        guard let selectedURL else { return }
        FinderService.reveal(selectedURL)
    }

    private func inspectDocument(_ url: URL, openAfterInspection: Bool) {
        let standardizedURL = url.standardizedFileURL
        selectedURL = standardizedURL
        analysis = nil
        documentHealthReport = nil
        magiAnalysisResult = nil
        magiAnalysisError = nil
        statusMessage = "正在檢查 \(standardizedURL.lastPathComponent)…"
        isWorking = true

        DispatchQueue.global(qos: .userInitiated).async { [inspector] in
            let result = Result { try inspector.analyze(url: standardizedURL) }
            DispatchQueue.main.async {
                self.isWorking = false
                switch result {
                case .success(let analysis):
                    self.analysis = analysis
                    self.documentHealthReport = DocumentHealthReport.evaluate(analysis)
                    self.recentDocuments = self.recentStore.record(
                        standardizedURL,
                        kind: analysis.kind,
                        in: self.recentDocuments
                    )
                    self.statusMessage = "檢查完成：\(analysis.riskLevel.displayName)"
                    if openAfterInspection {
                        self.open(standardizedURL, analysis: analysis, engine: analysis.preferredEngine)
                    }
                case .failure(let error):
                    self.analysis = nil
                    self.statusMessage = error.localizedDescription
                }
            }
        }
    }

    func launchEngine(_ engine: OfficeEngine) {
        do {
            try EngineLauncher.launch(engine)
            statusMessage = "已開啟 \(engine.displayName)"
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func runDocumentHealthReview() {
        guard let analysis else {
            statusMessage = "請先選擇文件，再執行本機文件健檢。"
            return
        }
        documentHealthReport = DocumentHealthReport.evaluate(analysis)
        statusMessage = "本機文件健檢完成：\(documentHealthReport?.conclusion ?? "已完成")"
    }

    func openMAGIConsole() {
        guard magiStatus?.singleActiveSafe != false else {
            statusMessage = "偵測到 MAGI 版本衝突，已停止開啟主控台。"
            return
        }
        do {
            try magiIntegration.openConsole()
            statusMessage = "已開啟本機 MAGI 主控台"
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func prepareSelectedForMAGI() {
        analyzeSelectedWithMAGI(mode: .complete)
    }

    func analyzeSelectedWithMAGI(mode: MAGIAnalysisMode, customInstruction: String = "") {
        guard let selectedURL, let analysis else {
            statusMessage = "請先選擇一份文件，再交給 MAGI 分析。"
            return
        }
        guard magiStatus?.agentAvailable == true else {
            statusMessage = "MAGI 尚未就緒；請先按重新檢查。"
            refreshMAGIStatus()
            return
        }
        guard !isAnalyzingWithMAGI else { return }
        isAnalyzingWithMAGI = true
        magiAnalysisError = nil
        statusMessage = "正在擷取文件文字並由 MAGI 執行\(mode.displayName)…"
        DispatchQueue.global(qos: .userInitiated).async { [magiIntegration] in
            let result = Result {
                try magiIntegration.analyzeDocument(
                    url: selectedURL,
                    analysis: analysis,
                    mode: mode,
                    customInstruction: customInstruction
                )
            }
            DispatchQueue.main.async {
                self.isAnalyzingWithMAGI = false
                switch result {
                case .success(let analysisResult):
                    self.magiAnalysisResult = analysisResult
                    self.magiAnalysisError = nil
                    self.statusMessage = "MAGI \(mode.displayName)完成"
                case .failure(let error):
                    let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                    self.magiAnalysisError = message
                    self.statusMessage = "MAGI 分析失敗：\(message)"
                }
            }
        }
    }

    func copyMAGIResponse() {
        guard let text = magiAnalysisResult?.reply.text else { return }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
        statusMessage = "MAGI 分析結果已複製"
    }

    func clearMAGIResponse() {
        magiAnalysisResult = nil
        magiAnalysisError = nil
    }

    func openPreferred() {
        guard let selectedURL, let analysis else { return }
        open(selectedURL, analysis: analysis, engine: analysis.preferredEngine)
    }

    func openAlternate() {
        guard let selectedURL, let analysis else { return }
        open(selectedURL, analysis: analysis, engine: analysis.alternateEngine)
    }

    private func open(_ sourceURL: URL, analysis: DocumentAnalysis, engine: OfficeEngine) {
        statusMessage = "正在建立安全備份…"
        isWorking = true
        DispatchQueue.global(qos: .userInitiated).async { [backupManager] in
            let result = Result { () -> (URL, URL) in
                let backup = try backupManager.createBackup(of: sourceURL)
                let openURL: URL
                if analysis.riskLevel == .high {
                    openURL = try backupManager.createSafeCopy(of: sourceURL)
                } else {
                    openURL = sourceURL
                }
                return (backup, openURL)
            }
            DispatchQueue.main.async {
                self.isWorking = false
                switch result {
                case .success(let payload):
                    self.lastBackupURL = payload.0
                    do {
                        try EngineLauncher.open(payload.1, using: engine)
                        self.statusMessage = analysis.riskLevel == .high
                            ? "已用 \(engine.displayName) 開啟唯讀安全副本"
                            : "已備份並用 \(engine.displayName) 開啟"
                    } catch {
                        self.statusMessage = error.localizedDescription
                    }
                case .failure(let error):
                    self.statusMessage = "備份失敗，已停止開啟：\(error.localizedDescription)"
                }
            }
        }
    }

    func convertSelectedToPDF() {
        guard let selectedURL else { return }
        statusMessage = "正在建立備份並轉換 PDF…"
        isWorking = true
        DispatchQueue.global(qos: .userInitiated).async { [backupManager, pdfConverter] in
            let result = Result { () -> (URL, URL) in
                let backup = try backupManager.createBackup(of: selectedURL)
                let pdf = try pdfConverter.convert(sourceURL: selectedURL)
                return (backup, pdf)
            }
            DispatchQueue.main.async {
                self.isWorking = false
                switch result {
                case .success(let payload):
                    self.lastBackupURL = payload.0
                    self.lastPDFURL = payload.1
                    self.statusMessage = "PDF 已完成：\(payload.1.lastPathComponent)"
                    FinderService.reveal(payload.1)
                case .failure(let error):
                    self.statusMessage = "PDF 轉換失敗：\(error.localizedDescription)"
                }
            }
        }
    }

    func renumberChineseHeadings() {
        guard let selectedURL else { return }
        statusMessage = "正在備份並整理中文標題編號…"
        isWorking = true
        DispatchQueue.global(qos: .userInitiated).async { [backupManager, headingService] in
            let result = Result { () -> (URL, URL) in
                let backup = try backupManager.createBackup(of: selectedURL)
                let output = try headingService.createRenumberedCopy(of: selectedURL)
                return (backup, output)
            }
            DispatchQueue.main.async {
                self.isWorking = false
                switch result {
                case .success(let payload):
                    self.lastBackupURL = payload.0
                    self.lastRenumberedURL = payload.1
                    self.statusMessage = "中文標題已套用標題層級並重新編號：\(payload.1.lastPathComponent)"
                    FinderService.reveal(payload.1)
                case .failure(let error):
                    self.statusMessage = "中文標題整理失敗：\(error.localizedDescription)"
                }
            }
        }
    }

    func revealBackup() {
        if let lastBackupURL {
            FinderService.reveal(lastBackupURL)
        } else {
            FinderService.reveal(backupManager.rootURL)
        }
    }

    func revealLastPDF() {
        guard let lastPDFURL else { return }
        FinderService.reveal(lastPDFURL)
    }

    func revealLastRenumbered() {
        guard let lastRenumberedURL else { return }
        FinderService.reveal(lastRenumberedURL)
    }
}
