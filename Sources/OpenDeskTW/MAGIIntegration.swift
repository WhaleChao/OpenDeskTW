import AppKit
import Foundation

enum MAGIRuntimeVersion: String, Codable {
    case v2
    case v3
    case inactive
    case conflict

    var displayName: String {
        switch self {
        case .v2: return "V2"
        case .v3: return "V3"
        case .inactive: return "未啟動"
        case .conflict: return "版本衝突"
        }
    }
}

struct MAGIEndpointProbe: Identifiable, Codable {
    let id: String
    let name: String
    let url: String
    let httpStatus: Int?
    let reachable: Bool
    let healthy: Bool
    let reportedStatus: String

    static func unavailable(id: String, name: String, url: String) -> MAGIEndpointProbe {
        MAGIEndpointProbe(
            id: id,
            name: name,
            url: url,
            httpStatus: nil,
            reachable: false,
            healthy: false,
            reportedStatus: "無法連線"
        )
    }
}

struct MAGIV3Compatibility: Codable {
    let found: Bool
    let releaseID: String?
    let releasePath: String?
    let manifestVerified: Bool
    let v2RoutesPreserved: Bool
    let canonicalEnvelopeVerified: Bool
    let compatible: Bool
    let detail: String
}

struct MAGIStatusReport: Codable {
    let activeVersion: MAGIRuntimeVersion
    let activeRuntimePath: String?
    let runningProcessCount: Int
    let singleActiveSafe: Bool
    let endpoints: [MAGIEndpointProbe]
    let v3Compatibility: MAGIV3Compatibility
    let checkedAt: String
    let summary: String

    var agentAvailable: Bool {
        singleActiveSafe
            && (activeVersion == .v2 || activeVersion == .v3)
            && endpoints.first(where: { $0.id == "main" })?.healthy == true
    }
}

enum MAGIAnalysisMode: String, Codable, CaseIterable, Identifiable {
    case complete
    case summary
    case proofread
    case structure

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .complete: return "完整分析"
        case .summary: return "內容摘要"
        case .proofread: return "校對與風險"
        case .structure: return "排版與結構"
        }
    }

    var instruction: String {
        switch self {
        case .complete:
            return "請依序提供：一、文件摘要；二、章節與論述結構；三、錯字、矛盾、遺漏或風險；四、排版與標題編號建議；五、可立即採用的修改清單。"
        case .summary:
            return "請忠實整理文件主旨、關鍵事實、重要數字、日期、人物與待辦事項，不要加入文件中沒有的內容。"
        case .proofread:
            return "請檢查錯別字、用詞不一致、前後矛盾、日期或數字疑點、法律或商務風險；逐項指出原文位置與修改建議。"
        case .structure:
            return "請分析標題層級、段落順序、表格或清單結構、編號連續性與閱讀動線，提出可在 Office 編輯器中實作的排版建議。"
        }
    }
}

struct MAGIChatReply: Codable {
    let text: String
    let route: String?
    let model: String?
    let requestID: String?
    let compatibilityVersion: String
    let degraded: Bool
}

struct MAGIDocumentAnalysisResult: Codable {
    let mode: MAGIAnalysisMode
    let extractedText: ExtractedDocumentText
    let reply: MAGIChatReply
}

enum MAGIIntegrationError: LocalizedError {
    case versionConflict
    case unavailable
    case missingCredential
    case requestTimedOut
    case rejected(Int)
    case invalidResponse
    case emptyReply

    var errorDescription: String? {
        switch self {
        case .versionConflict: return "偵測到 MAGI V2 與 V3 同時運作，已停止分析。"
        case .unavailable: return "MAGI 本機服務尚未就緒。"
        case .missingCredential: return "找不到 MAGI 的本機 API 驗證設定。"
        case .requestTimedOut: return "MAGI 分析逾時，請稍後再試或縮小文件內容。"
        case .rejected(let status): return "MAGI 拒絕分析請求（HTTP \(status)）。"
        case .invalidResponse: return "MAGI 回傳了無法辨識的資料格式。"
        case .emptyReply: return "MAGI 已完成請求，但沒有回傳分析文字。"
        }
    }
}

/// MAGI 的唯讀相容層。只偵測目前唯一啟用的版本，不會啟動、停止或切換 MAGI。
struct MAGIIntegration: Sendable {
    private var fileManager: FileManager { .default }

    private var applicationSupportRoot: URL {
        fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/MAGI", isDirectory: true)
    }

    private var v2RuntimeRoot: URL {
        applicationSupportRoot.appendingPathComponent("runtime/MAGI_v2", isDirectory: true)
    }

    private var v3RuntimeRoot: URL {
        applicationSupportRoot.appendingPathComponent("runtime/MAGI_v3", isDirectory: true)
    }

    private var v3CandidateRoot: URL {
        fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Desktop/MAGI_v3_candidates", isDirectory: true)
    }

    func status() -> MAGIStatusReport {
        let snapshot = processSnapshot()
        let v2Lines = snapshot.filter {
            isActiveRuntimeProcess($0, runtimeRoot: v2RuntimeRoot)
        }
        let v3Lines = snapshot.filter {
            isActiveRuntimeProcess($0, runtimeRoot: v3RuntimeRoot)
        }

        let activeVersion: MAGIRuntimeVersion
        let activePath: String?
        if !v2Lines.isEmpty && !v3Lines.isEmpty {
            activeVersion = .conflict
            activePath = nil
        } else if !v3Lines.isEmpty {
            activeVersion = .v3
            activePath = v3RuntimeRoot.path
        } else if !v2Lines.isEmpty {
            activeVersion = .v2
            activePath = v2RuntimeRoot.path
        } else {
            activeVersion = .inactive
            activePath = nil
        }

        let endpoints = [
            probe(id: "main", name: "MAGI 主服務", url: "http://127.0.0.1:5002/livez"),
            probe(id: "ready", name: "MAGI 就緒狀態", url: "http://127.0.0.1:5002/readyz"),
            probe(id: "tools", name: "MAGI 工具服務", url: "http://127.0.0.1:5003/health"),
            probe(id: "share", name: "本機分享閘道", url: "http://127.0.0.1:5014/health"),
            probe(id: "admin", name: "MAGI 管理服務", url: "http://127.0.0.1:8088/health")
        ]
        let compatibility = inspectV3Compatibility()
        let singleActiveSafe = activeVersion != .conflict
        let mainHealthy = endpoints.first(where: { $0.id == "main" })?.healthy == true
        let toolsHealthy = endpoints.first(where: { $0.id == "tools" })?.healthy == true

        let summary: String
        switch activeVersion {
        case .v2 where mainHealthy && toolsHealthy:
            summary = "MAGI V2 正在運作；V3 相容契約已\(compatibility.compatible ? "驗證" : "待確認")"
        case .v3 where mainHealthy && toolsHealthy:
            summary = "MAGI V3 正在運作，V2 相容介面可用"
        case .conflict:
            summary = "偵測到 V2 與 V3 同時運作；為保護資料，OpenDesk TW 不會呼叫 MAGI"
        case .inactive:
            summary = "目前未偵測到運作中的 MAGI"
        default:
            summary = "MAGI \(activeVersion.displayName) 已偵測，但服務尚未完全就緒"
        }

        return MAGIStatusReport(
            activeVersion: activeVersion,
            activeRuntimePath: activePath,
            runningProcessCount: v2Lines.count + v3Lines.count,
            singleActiveSafe: singleActiveSafe,
            endpoints: endpoints,
            v3Compatibility: compatibility,
            checkedAt: ISO8601DateFormatter().string(from: Date()),
            summary: summary
        )
    }

    func openConsole() throws {
        guard let url = URL(string: "http://127.0.0.1:5002/") else {
            throw OpenDeskError.invalidFile("無法建立 MAGI 本機網址。")
        }
        NSWorkspace.shared.open(url)
    }

    func copyDocumentPrompt(for analysis: DocumentAnalysis) {
        let headings = analysis.detectedHeadings.prefix(8).map { "標題 \($0.level)：\($0.text)" }.joined(separator: "\n")
        let prompt = """
        請以 MAGI 協助分析這份本機辦公文件；先說明你能讀取的範圍，再進行內容、結構與排版檢查。除非我明確同意，請勿覆寫原檔。

        文件名稱：\(analysis.fileName)
        本機路徑：\(analysis.filePath)
        文件類型：\(analysis.kind.displayName)（\(analysis.fileExtension.uppercased())）
        OpenDesk TW 風險分級：\(analysis.riskLevel.displayName)
        偵測字型：\(analysis.detectedFonts.joined(separator: "、"))
        \(headings.isEmpty ? "未偵測到中文標題。" : headings)
        """
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(prompt, forType: .string)
    }

    func analyzeDocument(
        url: URL,
        analysis: DocumentAnalysis,
        mode: MAGIAnalysisMode,
        customInstruction: String = ""
    ) throws -> MAGIDocumentAnalysisResult {
        let report = status()
        guard report.singleActiveSafe else { throw MAGIIntegrationError.versionConflict }
        guard report.agentAvailable else { throw MAGIIntegrationError.unavailable }

        let extracted = try DocumentTextExtractor().extract(from: url)
        let custom = customInstruction.trimmingCharacters(in: .whitespacesAndNewlines)
        let headingSummary = analysis.detectedHeadings.prefix(20).map {
            "標題 \($0.level)：\($0.text)"
        }.joined(separator: "\n")
        let extractionNote = extracted.truncated
            ? "原文共 \(extracted.originalCharacterCount) 字，本次取前 \(extracted.text.count) 字分析。"
            : "已擷取全文 \(extracted.originalCharacterCount) 字。"
        let prompt = """
        你是整合在 OpenDesk TW 裡的 MAGI 文件分析助手。請使用繁體中文回答，嚴格依據下列文件內容，不要臆測未提供的資訊；若只能根據文字判斷而無法確認視覺版面，必須明確說明。

        【分析任務】
        \(mode.instruction)
        \(custom.isEmpty ? "" : "使用者追加要求：\(custom)")

        【文件資料】
        名稱：\(analysis.fileName)
        類型：\(analysis.kind.displayName)（\(analysis.fileExtension.uppercased())）
        檔案大小：\(analysis.humanSize)
        OpenDesk TW 風險分級：\(analysis.riskLevel.displayName)
        擷取方式：\(extracted.sourceDescription)
        擷取範圍：\(extractionNote)
        偵測字型：\(analysis.detectedFonts.isEmpty ? "未指定" : analysis.detectedFonts.joined(separator: "、"))
        \(headingSummary.isEmpty ? "未偵測到中文標題列。" : headingSummary)

        【文件內容開始】
        \(extracted.text)
        【文件內容結束】

        請用清楚的小標題與條列回答；每項疑點盡量引用短句或指出章節／儲存格／投影片位置。不要覆寫或修改原檔。
        """
        let reply = try chat(prompt: prompt, activeVersion: report.activeVersion)
        return MAGIDocumentAnalysisResult(mode: mode, extractedText: extracted, reply: reply)
    }

    func chat(prompt: String, activeVersion: MAGIRuntimeVersion? = nil) throws -> MAGIChatReply {
        let credentials = try credentials(for: activeVersion)
        let payload: [String: Any] = [
            "prompt": prompt,
            "timeout_sec": 90,
            "allow_fallback": true,
            "allow_template_fallback": true,
            "user_id": "opendesk-tw",
            "platform": "OPENDESK_TW",
            "role": "user"
        ]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let temporaryFolder = fileManager.temporaryDirectory
            .appendingPathComponent("OpenDeskTW-MAGI-\(UUID().uuidString)", isDirectory: true)
        let configURL = temporaryFolder.appendingPathComponent("curl.conf")
        try fileManager.createDirectory(at: temporaryFolder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        defer { try? fileManager.removeItem(at: temporaryFolder) }
        var config = "header = \"X-API-Key: \(curlConfigValue(credentials.apiKey))\"\n"
        if let tenantID = credentials.tenantID, !tenantID.isEmpty {
            config += "header = \"X-MAGI-Tenant: \(curlConfigValue(tenantID))\"\n"
        }
        try Data(config.utf8).write(to: configURL, options: .atomic)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: configURL.path)

        let result = try ProcessRunner.run(
            executable: "/usr/bin/curl",
            arguments: [
                "--config", configURL.path,
                "--noproxy", "*",
                "--silent",
                "--show-error",
                "--max-time", "100",
                "--request", "POST",
                "--header", "Content-Type: application/json",
                "--header", "Accept: application/json",
                "--user-agent", "OpenDesk-TW/1.4",
                "--data-binary", "@-",
                "--write-out", "\n%{http_code}",
                "http://127.0.0.1:5003/collab/chat"
            ],
            standardInput: body
        )
        if result.exitCode == 28 { throw MAGIIntegrationError.requestTimedOut }
        guard result.exitCode == 0 else { throw MAGIIntegrationError.unavailable }
        var lines = result.standardOutput.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard let statusCode = Int(lines.popLast() ?? "") else { throw MAGIIntegrationError.invalidResponse }
        let responseData = Data(lines.joined(separator: "\n").utf8)
        guard (200..<300).contains(statusCode) else {
            throw MAGIIntegrationError.rejected(statusCode)
        }
        guard let object = try? JSONSerialization.jsonObject(with: responseData) as? [String: Any] else {
            throw MAGIIntegrationError.invalidResponse
        }
        return try adaptChatResponse(object, activeVersion: activeVersion)
    }

    private func curlConfigValue(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\r", with: "")
            .replacingOccurrences(of: "\n", with: "")
    }

    private func credentials(for activeVersion: MAGIRuntimeVersion?) throws -> (apiKey: String, tenantID: String?) {
        let version = activeVersion ?? detectedVersionForCredentials()
        var candidates: [URL] = []
        if version == .v3 {
            candidates.append(v3RuntimeRoot.appendingPathComponent("shared/external/.env"))
            candidates.append(v3RuntimeRoot.appendingPathComponent(".env"))
            candidates.append(v2RuntimeRoot.appendingPathComponent(".env"))
        } else {
            candidates.append(v2RuntimeRoot.appendingPathComponent(".env"))
            candidates.append(v3RuntimeRoot.appendingPathComponent("shared/external/.env"))
        }

        var values = ProcessInfo.processInfo.environment
        for url in candidates where fileManager.fileExists(atPath: url.path) {
            if let content = try? String(contentsOf: url, encoding: .utf8) {
                for (key, value) in parseEnvironment(content) where values[key]?.isEmpty != false {
                    values[key] = value
                }
            }
        }
        guard let apiKey = values["MAGI_API_KEY"]?.trimmingCharacters(in: .whitespacesAndNewlines),
              !apiKey.isEmpty else {
            throw MAGIIntegrationError.missingCredential
        }
        let tenantID = values["MAGI_TENANT_ID"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (apiKey, tenantID?.isEmpty == false ? tenantID : nil)
    }

    private func detectedVersionForCredentials() -> MAGIRuntimeVersion {
        let snapshot = processSnapshot()
        if snapshot.contains(where: { isActiveRuntimeProcess($0, runtimeRoot: v3RuntimeRoot) }) {
            return .v3
        }
        return .v2
    }

    private func isActiveRuntimeProcess(_ line: String, runtimeRoot: URL) -> Bool {
        guard line.localizedCaseInsensitiveContains("python") else { return false }
        let normalizedLine = line.lowercased()
        let normalizedRoot = runtimeRoot.standardizedFileURL.path.lowercased() + "/"
        return normalizedLine.contains(normalizedRoot)
    }

    private func parseEnvironment(_ content: String) -> [String: String] {
        var values: [String: String] = [:]
        for rawLine in content.split(whereSeparator: \Character.isNewline) {
            var line = String(rawLine).trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("export ") {
                line = String(line.dropFirst(7)).trimmingCharacters(in: .whitespaces)
            }
            guard !line.isEmpty, !line.hasPrefix("#"), let separator = line.firstIndex(of: "=") else { continue }
            let key = String(line[..<separator]).trimmingCharacters(in: .whitespaces)
            var value = String(line[line.index(after: separator)...]).trimmingCharacters(in: .whitespaces)
            if value.count >= 2,
               (value.hasPrefix("\"") && value.hasSuffix("\"") || value.hasPrefix("'") && value.hasSuffix("'")) {
                value.removeFirst()
                value.removeLast()
            }
            if !key.isEmpty { values[key] = value }
        }
        return values
    }

    private func adaptChatResponse(
        _ object: [String: Any],
        activeVersion: MAGIRuntimeVersion?
    ) throws -> MAGIChatReply {
        if object["success"] as? Bool == false || object["ok"] as? Bool == false {
            throw MAGIIntegrationError.invalidResponse
        }
        let dataObject = object["data"] as? [String: Any]
        let answerObject = dataObject?["answer"] as? [String: Any]
        let candidates = [object, dataObject, answerObject].compactMap { $0 }
        var text: String?
        for candidate in candidates {
            for key in ["response", "text", "analysis", "summary", "reply"] {
                if let value = candidate[key] as? String,
                   !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    text = value
                    break
                }
            }
            if text != nil { break }
        }
        if text == nil, let dataText = object["data"] as? String { text = dataText }
        guard let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
            throw MAGIIntegrationError.emptyReply
        }

        let meta = object["meta"] as? [String: Any]
        let routeObject = candidates.compactMap { $0["route"] as? [String: Any] }.first
        let route = candidates.compactMap { $0["route"] as? String }.first
            ?? routeObject?["path"] as? String
            ?? meta?["route"] as? String
        let model = candidates.compactMap { $0["model"] as? String }.first
            ?? routeObject?["model"] as? String
            ?? meta?["model"] as? String
        let requestID = candidates.compactMap { $0["request_id"] as? String }.first
            ?? meta?["request_id"] as? String
        let compatibilityVersion = meta?["compat_version"] as? String
            ?? activeVersion?.rawValue
            ?? "v2"
        let degraded = candidates.compactMap { $0["degraded"] as? Bool }.first
            ?? meta?["degraded"] as? Bool
            ?? false
        return MAGIChatReply(
            text: text,
            route: route,
            model: model,
            requestID: requestID,
            compatibilityVersion: compatibilityVersion,
            degraded: degraded
        )
    }

    private func processSnapshot() -> [String] {
        guard let result = try? ProcessRunner.run(
            executable: "/usr/bin/pgrep",
            arguments: ["-fl", "MAGI_v2|MAGI_v3|magi_v3"]
        ),
              result.exitCode == 0 else {
            return []
        }
        return result.standardOutput
            .split(separator: "\n")
            .map(String.init)
            .filter { !$0.contains("OpenDeskTW --") }
    }

    private func probe(id: String, name: String, url: String) -> MAGIEndpointProbe {
        guard URL(string: url) != nil else {
            return .unavailable(id: id, name: name, url: url)
        }
        guard let result = try? ProcessRunner.run(
            executable: "/usr/bin/curl",
            arguments: [
                "--noproxy", "*",
                "--silent",
                "--show-error",
                "--max-time", "3",
                "--header", "Accept: application/json",
                "--user-agent", "OpenDesk-TW/1.4",
                "--write-out", "\n%{http_code}",
                url
            ]
        ) else {
            return .unavailable(id: id, name: name, url: url)
        }

        var lines = result.standardOutput.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        let httpStatus = Int(lines.popLast() ?? "")
        let body = lines.joined(separator: "\n")
        let data = Data(body.utf8)
        let object = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        guard let httpStatus, httpStatus > 0 else {
            return .unavailable(id: id, name: name, url: url)
        }
        let statusText = Self.statusText(from: object, httpStatus: httpStatus)
        let declaredHealthy = (object["ok"] as? Bool)
            ?? (object["ready"] as? Bool)
            ?? (object["success"] as? Bool)
        let statusHealthy = ["ok", "live", "ready", "operational", "正常"].contains(statusText.lowercased())
        let httpHealthy = (200..<300).contains(httpStatus)
        return MAGIEndpointProbe(
            id: id,
            name: name,
            url: url,
            httpStatus: httpStatus,
            reachable: true,
            healthy: httpHealthy && (declaredHealthy ?? statusHealthy),
            reportedStatus: statusText
        )
    }

    private static func statusText(from object: [String: Any], httpStatus: Int) -> String {
        if let status = object["status"] as? String, !status.isEmpty { return status }
        if let probe = object["probe"] as? String, !probe.isEmpty { return probe }
        if object["ok"] as? Bool == true { return "正常" }
        return "HTTP \(httpStatus)"
    }

    private func inspectV3Compatibility() -> MAGIV3Compatibility {
        if let resourceURL = Bundle.main.url(forResource: "MAGICompatibility", withExtension: "json"),
           let data = try? Data(contentsOf: resourceURL),
           let bundled = try? JSONDecoder().decode(MAGIV3Compatibility.self, from: data) {
            return bundled
        }

        guard let candidateNames = try? fileManager.contentsOfDirectory(atPath: v3CandidateRoot.path) else {
            return MAGIV3Compatibility(
                found: false,
                releaseID: nil,
                releasePath: nil,
                manifestVerified: false,
                v2RoutesPreserved: false,
                canonicalEnvelopeVerified: false,
                compatible: false,
                detail: "找不到 MAGI V3 候選版本。"
            )
        }

        let releases = candidateNames
            .filter { $0.hasPrefix("v3-") }
            .sorted()
            .reversed()
            .map { v3CandidateRoot.appendingPathComponent($0, isDirectory: true) }
        let selected = releases.first {
            fileManager.fileExists(atPath: $0.appendingPathComponent("RELEASE_COMPLETE.json").path)
        }
        guard let selected else {
            return MAGIV3Compatibility(
                found: false,
                releaseID: nil,
                releasePath: nil,
                manifestVerified: false,
                v2RoutesPreserved: false,
                canonicalEnvelopeVerified: false,
                compatible: false,
                detail: "V3 資料夾存在，但沒有完成版標記。"
            )
        }

        let completionURL = selected.appendingPathComponent("RELEASE_COMPLETE.json")
        let manifestURL = selected.appendingPathComponent("release-manifest.json")
        let routesURL = selected.appendingPathComponent("docs/architecture/v3/generated/v2_runtime_routes.json")
        let envelopeURL = selected.appendingPathComponent("docs/architecture/v3/contracts/api-envelope.schema.json")

        let completion = jsonObject(at: completionURL)
        let releaseID = completion?["release_id"] as? String ?? selected.lastPathComponent
        let manifestVerified = fileManager.fileExists(atPath: manifestURL.path)
            && completion?["manifest"] as? String == "release-manifest.json"

        let routes = jsonObject(at: routesURL)
        let services = routes?["services"] as? [String: Any]
        let mainRules = rules(in: services?["5002"])
        let toolsRules = rules(in: services?["5003"])
        let requiredMain: Set<String> = ["/livez", "/readyz", "/health", "/api/osc/chat"]
        let requiredTools: Set<String> = ["/livez", "/health"]
        let v2RoutesPreserved = requiredMain.isSubset(of: mainRules) && requiredTools.isSubset(of: toolsRules)

        let envelope = jsonObject(at: envelopeURL)
        let envelopeText = (try? String(contentsOf: envelopeURL, encoding: .utf8)) ?? ""
        let canonicalEnvelopeVerified = envelope?["title"] != nil
            && envelopeText.contains("\"compat_version\"")
            && envelopeText.contains("\"v2\"")
            && envelopeText.contains("\"v3\"")

        let compatible = manifestVerified && v2RoutesPreserved && canonicalEnvelopeVerified
        return MAGIV3Compatibility(
            found: true,
            releaseID: releaseID,
            releasePath: selected.path,
            manifestVerified: manifestVerified,
            v2RoutesPreserved: v2RoutesPreserved,
            canonicalEnvelopeVerified: canonicalEnvelopeVerified,
            compatible: compatible,
            detail: compatible
                ? "已離線驗證 V3 完成版、V2 路由與 V2／V3 回應封套；未啟動 V3。"
                : "已找到 V3，但相容契約未完整通過。"
        )
    }

    private func jsonObject(at url: URL) -> [String: Any]? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    private func rules(in service: Any?) -> Set<String> {
        guard let rows = service as? [[String: Any]] else { return [] }
        return Set(rows.compactMap { $0["rule"] as? String })
    }
}
