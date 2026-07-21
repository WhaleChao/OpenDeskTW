import Foundation

struct OfficeSelfTestCheck: Codable, Identifiable, Hashable {
    let name: String
    let passed: Bool
    let detail: String

    var id: String { name }
}

struct OfficeSelfTestGroup: Codable, Identifiable, Hashable {
    let name: String
    let checks: [OfficeSelfTestCheck]

    var id: String { name }
    var passed: Bool { checks.allSatisfy(\.passed) }
    var passedCount: Int { checks.filter(\.passed).count }
}

struct OfficeSelfTestReport: Codable {
    let schemaVersion: Int
    let suite: String
    let appVersion: String
    let runAt: Date
    let passed: Bool
    let summary: String
    let passedCount: Int
    let totalCount: Int
    let groups: [OfficeSelfTestGroup]
    let boundaries: [String]
    let reportPath: String
}

private struct OfficeFeatureMatrixManifest: Codable {
    let schemaVersion: Int
    let suite: String
    let generatedForVersion: String
    let passed: Bool
    let summary: String
    let passedCount: Int
    let totalCount: Int
    let groups: [String: [OfficeSelfTestCheck]]
    let boundaries: [String]
}

struct OfficeSelfTestService: Sendable {
    private let fixtureNames = [
        ("OpenDeskTW_完整文字功能.docx", DocumentKind.text, "文字文件進階功能矩陣"),
        ("OpenDeskTW_完整試算表功能.xlsx", DocumentKind.spreadsheet, "試算表進階功能矩陣"),
        ("OpenDeskTW_完整簡報功能.pptx", DocumentKind.presentation, "簡報進階功能矩陣"),
    ]

    func run() throws -> OfficeSelfTestReport {
        let verificationRoot = try bundledVerificationRoot()
        let manifestURL = verificationRoot.appendingPathComponent("OfficeFeatureMatrix.json")
        let manifestData = try Data(contentsOf: manifestURL)
        let manifest = try JSONDecoder().decode(OfficeFeatureMatrixManifest.self, from: manifestData)

        let preferredOrder = ["文字文件", "試算表", "簡報", "PDF"]
        var groups = preferredOrder.compactMap { name in
            manifest.groups[name].map { OfficeSelfTestGroup(name: name, checks: $0) }
        }
        for name in manifest.groups.keys.sorted() where !preferredOrder.contains(name) {
            groups.append(OfficeSelfTestGroup(name: name, checks: manifest.groups[name] ?? []))
        }

        var runtimeChecks: [OfficeSelfTestCheck] = EngineLocator.allStatuses().map { status in
            OfficeSelfTestCheck(
                name: "\(status.engine.displayName) 編輯引擎",
                passed: status.installed,
                detail: status.installed ? "已安裝 \(status.version ?? "版本未知")" : "找不到 \(status.engine.displayName)"
            )
        }

        let inspector = DocumentInspector()
        let extractor = DocumentTextExtractor(maximumCharacters: 80_000)
        let converter = PDFConverter()
        let temporaryRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("OpenDeskTW-SelfTest-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: temporaryRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporaryRoot) }

        for (fileName, expectedKind, marker) in fixtureNames {
            let sourceURL = verificationRoot.appendingPathComponent(fileName)
            do {
                let analysis = try inspector.analyze(url: sourceURL)
                let extracted = try extractor.extract(from: sourceURL)
                runtimeChecks.append(OfficeSelfTestCheck(
                    name: "\(expectedKind.displayName)實檔讀取",
                    passed: analysis.kind == expectedKind && extracted.text.contains(marker),
                    detail: "已讀取 \(analysis.packageEntriesInspected) 個 OOXML 項目與 \(extracted.originalCharacterCount) 個字元"
                ))
            } catch {
                runtimeChecks.append(OfficeSelfTestCheck(
                    name: "\(expectedKind.displayName)實檔讀取",
                    passed: false,
                    detail: error.localizedDescription
                ))
            }

            do {
                let pdfURL = try converter.convert(sourceURL: sourceURL, destinationRoot: temporaryRoot)
                let pdfText = try extractor.extract(from: pdfURL)
                runtimeChecks.append(OfficeSelfTestCheck(
                    name: "\(expectedKind.displayName)轉 PDF",
                    passed: FileManager.default.fileExists(atPath: pdfURL.path) && !pdfText.text.isEmpty,
                    detail: "已產生可搜尋 PDF（\(pdfText.originalCharacterCount) 個字元）"
                ))
            } catch {
                runtimeChecks.append(OfficeSelfTestCheck(
                    name: "\(expectedKind.displayName)轉 PDF",
                    passed: false,
                    detail: error.localizedDescription
                ))
            }
        }
        groups.append(OfficeSelfTestGroup(name: "本機 LIVE 驗證", checks: runtimeChecks))

        let magi = MAGIIntegration().status()
        let magiChecks = [
            OfficeSelfTestCheck(
                name: "MAGI 本機 Agent",
                passed: magi.agentAvailable && magi.singleActiveSafe,
                detail: "\(magi.activeVersion.displayName)；\(magi.singleActiveSafe ? "單一版本保護正常" : "發現版本衝突")"
            ),
            OfficeSelfTestCheck(
                name: "MAGI V2／V3 相容契約",
                passed: magi.v3Compatibility.compatible,
                detail: magi.v3Compatibility.compatible ? "V2 路由與 V3 相容封裝均已驗證" : "V3 相容契約尚未通過"
            ),
        ]
        groups.append(OfficeSelfTestGroup(name: "MAGI 相容性", checks: magiChecks))

        let passedCount = groups.flatMap(\.checks).filter(\.passed).count
        let totalCount = groups.flatMap(\.checks).count
        let reportDirectory = try reportsDirectory()
        let reportURL = reportDirectory.appendingPathComponent("OfficeSelfTest-\(Self.timestamp.string(from: Date())).json")
        let report = OfficeSelfTestReport(
            schemaVersion: 1,
            suite: "OpenDesk TW Office 完整相容性自我檢查",
            appVersion: "1.4.0",
            runAt: Date(),
            passed: passedCount == totalCount,
            summary: "\(passedCount)/\(totalCount) 項通過",
            passedCount: passedCount,
            totalCount: totalCount,
            groups: groups,
            boundaries: manifest.boundaries,
            reportPath: reportURL.path
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(report).write(to: reportURL, options: .atomic)
        return report
    }

    private func bundledVerificationRoot() throws -> URL {
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("Verification", isDirectory: true),
              FileManager.default.fileExists(atPath: root.path) else {
            throw OpenDeskError.outputMissing("OpenDesk TW 內建 Verification 測試組")
        }
        return root
    }

    private func reportsDirectory() throws -> URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("OpenDesk TW/Reports", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    private static let timestamp: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter
    }()
}
