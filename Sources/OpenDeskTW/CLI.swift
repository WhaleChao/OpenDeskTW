import Foundation

enum OpenDeskCLI {
    private struct HealthReport: Codable {
        let app: String
        let version: String
        let platform: String
        let engines: [EngineStatus]
        let magi: MAGIStatusReport
        let backupRoot: String
        let exportRoot: String
        let healthy: Bool
    }

    static func run(_ arguments: [String]) -> Int32 {
        guard let command = arguments.first else {
            printUsage()
            return 2
        }

        do {
            switch command {
            case "--health":
                let engines = EngineLocator.allStatuses()
                let magi = MAGIIntegration().status()
                let report = HealthReport(
                    app: "OpenDesk TW",
                    version: "1.4.0",
                    platform: "macOS",
                    engines: engines,
                    magi: magi,
                    backupRoot: BackupManager().rootURL.path,
                    exportRoot: PDFConverter().exportRootURL.path,
                    healthy: engines.allSatisfy(\.installed)
                )
                try printJSON(report)
                return report.healthy ? 0 : 1

            case "--route":
                let url = try fileURL(from: arguments)
                let ext = url.pathExtension.lowercased()
                try printJSON([
                    "file": url.path,
                    "kind": DocumentRouter.kind(for: ext).rawValue,
                    "preferredEngine": DocumentRouter.preferredEngine(for: ext).rawValue
                ])
                return 0

            case "--scan":
                let url = try fileURL(from: arguments)
                let report = try DocumentInspector().analyze(url: url)
                try printJSON(report)
                return report.riskLevel == .high ? 3 : 0

            case "--document-health":
                let url = try fileURL(from: arguments)
                let analysis = try DocumentInspector().analyze(url: url)
                let report = DocumentHealthReport.evaluate(analysis)
                try printJSON(report)
                return report.verdicts.contains(where: { $0.outcome == .protected }) ? 3 : 0

            case "--magi", "--magi-status":
                let report = MAGIIntegration().status()
                try printJSON(report)
                return report.agentAvailable && report.v3Compatibility.compatible ? 0 : 1

            case "--extract-text":
                let url = try fileURL(from: arguments)
                let extracted = try DocumentTextExtractor().extract(from: url)
                try printJSON(extracted)
                return 0

            case "--magi-analyze":
                let url = try fileURL(from: arguments)
                let mode = arguments.count >= 3 ? (MAGIAnalysisMode(rawValue: arguments[2]) ?? .complete) : .complete
                let customInstruction = arguments.count >= 4 ? arguments.dropFirst(3).joined(separator: " ") : ""
                let analysis = try DocumentInspector().analyze(url: url)
                let result = try MAGIIntegration().analyzeDocument(
                    url: url,
                    analysis: analysis,
                    mode: mode,
                    customInstruction: customInstruction
                )
                try printJSON(result)
                return 0

            case "--backup":
                let url = try fileURL(from: arguments)
                let backupURL = try BackupManager().createBackup(of: url)
                try printJSON(["source": url.path, "backup": backupURL.path])
                return 0

            case "--create-document":
                guard arguments.count >= 3,
                      let type = NewDocumentType(commandLineValue: arguments[1]) else {
                    throw OpenDeskError.invalidFile("用法：--create-document <text|spreadsheet|presentation> <輸出路徑>")
                }
                let requestedURL = URL(fileURLWithPath: arguments[2]).standardizedFileURL
                let outputURL = requestedURL.pathExtension.isEmpty
                    ? requestedURL.appendingPathExtension(type.fileExtension)
                    : requestedURL
                try DocumentTemplateService().createCopy(of: type, at: outputURL)
                let analysis = try DocumentInspector().analyze(url: outputURL)
                try printJSON([
                    "type": type.rawValue,
                    "file": outputURL.path,
                    "kind": analysis.kind.rawValue,
                    "risk": analysis.riskLevel.displayName
                ])
                return 0

            case "--headings":
                let url = try fileURL(from: arguments)
                let headings = try ChineseHeadingService().detect(in: url)
                try printJSON(headings)
                return headings.isEmpty ? 4 : 0

            case "--renumber-headings":
                let url = try fileURL(from: arguments)
                let backupURL = try BackupManager().createBackup(of: url)
                let outputURL = try ChineseHeadingService().createRenumberedCopy(of: url)
                try printJSON([
                    "source": url.path,
                    "backup": backupURL.path,
                    "renumbered": outputURL.path
                ])
                return 0

            case "--convert-pdf":
                let url = try fileURL(from: arguments)
                let destination = arguments.count >= 3
                    ? URL(fileURLWithPath: arguments[2], isDirectory: true)
                    : nil
                let outputURL = try PDFConverter().convert(sourceURL: url, destinationRoot: destination)
                try printJSON(["source": url.path, "pdf": outputURL.path])
                return 0

            case "--office-self-test":
                let report = try OfficeSelfTestService().run()
                try printJSON(report)
                return report.passed ? 0 : 1

            case "--help", "-h":
                printUsage()
                return 0

            default:
                fputs("未知指令：\(command)\n", stderr)
                printUsage()
                return 2
            }
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            fputs("OpenDesk TW 錯誤：\(message)\n", stderr)
            return 1
        }
    }

    private static func fileURL(from arguments: [String]) throws -> URL {
        guard arguments.count >= 2 else {
            throw OpenDeskError.invalidFile("缺少文件路徑。")
        }
        let url = URL(fileURLWithPath: arguments[1]).standardizedFileURL
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw OpenDeskError.invalidFile("找不到文件：\(url.path)")
        }
        return url
    }

    private static func printJSON<T: Encodable>(_ value: T) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(value)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }

    private static func printUsage() {
        print("""
        OpenDesk TW 驗證工具
          --health                         檢查文件引擎與 MAGI
          --route <file>                   顯示文件路由
          --scan <file>                    掃描相容性與字型風險
          --document-health <file>         執行本機文件結構／字型／安全健檢
          --magi-status                    唯讀檢查 MAGI V2／V3 相容狀態
          --magi                           --magi-status 的簡寫
          --extract-text <file>            擷取交給 MAGI 的文件文字
          --magi-analyze <file> [mode]     直接執行 MAGI 文件分析
                                           mode: complete／summary／proofread／structure
          --backup <file>                  建立版本備份
          --create-document <type> <path>  從內建範本建立 DOCX／XLSX／PPTX
          --headings <file>                辨識中文標題層級
          --renumber-headings <file>       備份並建立重新編號副本
          --convert-pdf <file> [folder]    轉換為 PDF
          --office-self-test               執行內建完整 Office LIVE 自我檢查
        """)
    }
}
