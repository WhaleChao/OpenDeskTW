import AppKit
import Foundation

struct DocumentInspector {
    private let ooxmlExtensions: Set<String> = ["docx", "docm", "xlsx", "xlsm", "pptx", "pptm"]
    private let macroExtensions: Set<String> = ["docm", "xlsm", "pptm"]

    func analyze(url: URL) throws -> DocumentAnalysis {
        let resourceValues = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        guard resourceValues.isRegularFile == true else {
            throw OpenDeskError.invalidFile("請選擇一般文件，不要選擇資料夾。")
        }

        let fileExtension = url.pathExtension.lowercased()
        let preferredEngine = DocumentRouter.preferredEngine(for: fileExtension)
        var issues: [CompatibilityIssue] = []
        var detectedFonts: [String] = []
        var entriesInspected = 0
        var detectedHeadings: [DetectedHeading] = []

        if macroExtensions.contains(fileExtension) {
            issues.append(CompatibilityIssue(
                level: .high,
                title: "含巨集的 Office 格式",
                detail: "預設以唯讀安全副本開啟；VBA、ActiveX 與 Office 增益集無法保證相容。"
            ))
        }

        if ["doc", "xls", "ppt"].contains(fileExtension) {
            issues.append(CompatibilityIssue(
                level: .attention,
                title: "舊版二進位格式",
                detail: "會交由 LibreOffice 救援引擎開啟，另存前保留原始檔。"
            ))
        }

        if ooxmlExtensions.contains(fileExtension) {
            let packageResult = inspectOOXML(url: url)
            issues.append(contentsOf: packageResult.issues)
            detectedFonts = packageResult.fonts
            entriesInspected = packageResult.entriesInspected
        }

        if ["docx", "docm"].contains(fileExtension),
           let headings = try? ChineseHeadingService().detect(in: url) {
            detectedHeadings = headings
            if !headings.isEmpty {
                issues.append(CompatibilityIssue(
                    level: .normal,
                    title: "辨識到 \(headings.count) 個中文標題列",
                    detail: "只辨識段落開頭的「壹、」、「一、」、「（一）」與阿拉伯數字層級，可建立重新編號副本；內文中出現不會誤判。"
                ))
            }
        }

        let availableFonts = availableFontNames()
        var fontSubstitutions: [String: String] = [:]
        let missingFonts = detectedFonts.filter { font in
            guard !availableFonts.contains(font.lowercased()) && !font.hasPrefix("+") else { return false }
            if let replacement = replacementFont(for: font), availableFonts.contains(replacement.lowercased()) {
                fontSubstitutions[font] = replacement
                return false
            }
            return true
        }

        if !missingFonts.isEmpty {
            issues.append(CompatibilityIssue(
                level: .attention,
                title: "缺少 \(missingFonts.count) 種字型",
                detail: "輸出 PDF 或重新排版前會顯示替代字型建議，避免靜默位移。"
            ))
        }

        if !fontSubstitutions.isEmpty {
            issues.append(CompatibilityIssue(
                level: .normal,
                title: "已準備 \(fontSubstitutions.count) 組開源替代字型",
                detail: "開啟前顯示替代關係；轉 PDF 時使用本機相容字型，避免無聲缺字。"
            ))
        }

        if issues.isEmpty {
            issues.append(CompatibilityIssue(
                level: .normal,
                title: "未偵測到已知高風險功能",
                detail: "仍會在開啟前建立版本備份。"
            ))
        }

        let riskLevel = issues.map(\.level).max() ?? .normal
        return DocumentAnalysis(
            fileName: url.lastPathComponent,
            filePath: url.path,
            fileExtension: fileExtension,
            fileSize: Int64(resourceValues.fileSize ?? 0),
            kind: DocumentRouter.kind(for: fileExtension),
            preferredEngine: preferredEngine,
            alternateEngine: preferredEngine == .onlyOffice ? .libreOffice : .onlyOffice,
            riskLevel: riskLevel,
            issues: issues.sorted { $0.level.rawValue > $1.level.rawValue },
            detectedFonts: detectedFonts,
            missingFonts: missingFonts,
            fontSubstitutions: fontSubstitutions,
            packageEntriesInspected: entriesInspected,
            detectedHeadings: detectedHeadings
        )
    }

    private func inspectOOXML(url: URL) -> (issues: [CompatibilityIssue], fonts: [String], entriesInspected: Int) {
        guard let listResult = try? ProcessRunner.run(
            executable: "/usr/bin/unzip",
            arguments: ["-Z1", url.path]
        ), listResult.exitCode == 0 else {
            return ([CompatibilityIssue(
                level: .high,
                title: "無法檢查 OOXML 套件",
                detail: "文件可能已加密、損壞或不是有效的 Office Open XML 檔案。"
            )], [], 0)
        }

        let entries = listResult.standardOutput
            .split(separator: "\n")
            .map(String.init)
        var issues: [CompatibilityIssue] = []
        let lowerEntries = entries.map { $0.lowercased() }

        func containsEntry(_ fragment: String) -> Bool {
            lowerEntries.contains { $0.contains(fragment.lowercased()) }
        }

        func containsFileEntry(_ fragment: String) -> Bool {
            lowerEntries.contains { $0.contains(fragment.lowercased()) && !$0.hasSuffix("/") }
        }

        if containsEntry("vbaproject.bin") {
            issues.append(CompatibilityIssue(level: .high, title: "偵測到 VBA", detail: "會以安全副本開啟，原檔不會被覆寫。"))
        }
        if containsEntry("activex/") {
            issues.append(CompatibilityIssue(level: .high, title: "偵測到 ActiveX", detail: "開源引擎無法完整執行 ActiveX 控制項。"))
        }
        if containsEntry("externallinks/") || containsEntry("connections.xml") {
            issues.append(CompatibilityIssue(level: .attention, title: "偵測到外部資料連線", detail: "外部連線預設不自動更新。"))
        }
        if containsFileEntry("embeddings/") {
            issues.append(CompatibilityIssue(level: .attention, title: "偵測到嵌入物件", detail: "OLE 或嵌入檔案可能只能顯示，未必能編輯。"))
        }
        if containsEntry("diagrams/") || containsEntry("diagram/") {
            issues.append(CompatibilityIssue(level: .attention, title: "偵測到 SmartArt／圖表物件", detail: "開啟後需核對位置與字型。"))
        }
        if containsEntry("pivotcache/") || containsEntry("slicer") {
            issues.append(CompatibilityIssue(level: .attention, title: "偵測到樞紐分析或交叉分析篩選器", detail: "公式與顯示結果需做往返驗證。"))
        }

        let candidateXML = entries.filter { entry in
            let lower = entry.lowercased()
            guard lower.hasSuffix(".xml") else { return false }
            return lower.contains("styles")
                || lower.contains("document.xml")
                || lower.contains("presentation.xml")
                || lower.contains("/slides/slide")
        }.prefix(40)

        var fonts = Set<String>()
        for entry in candidateXML {
            guard let contentResult = try? ProcessRunner.run(
                executable: "/usr/bin/unzip",
                arguments: ["-p", url.path, entry]
            ), contentResult.exitCode == 0 else { continue }
            extractFonts(
                from: contentResult.standardOutput,
                includeSpreadsheetFontNames: entry.lowercased().contains("xl/styles")
            ).forEach { fonts.insert($0) }
        }

        return (issues, fonts.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }, entries.count)
    }

    private func extractFonts(from xml: String, includeSpreadsheetFontNames: Bool) -> [String] {
        var patterns = [
            #"w:(?:ascii|hAnsi|eastAsia|cs)="([^"]+)""#,
            #"typeface="([^"]+)""#
        ]
        if includeSpreadsheetFontNames {
            patterns.append(#"<name\b[^>]+val="([^"]+)""#)
        }
        var result = Set<String>()
        let fullRange = NSRange(xml.startIndex..<xml.endIndex, in: xml)
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
            for match in regex.matches(in: xml, range: fullRange) {
                guard match.numberOfRanges > 1,
                      let range = Range(match.range(at: 1), in: xml) else { continue }
                let value = decodeXMLEntities(String(xml[range])).trimmingCharacters(in: .whitespacesAndNewlines)
                if !value.isEmpty && value.lowercased() != "none" && !value.hasPrefix("+") {
                    result.insert(value)
                }
            }
        }
        return Array(result)
    }

    private func decodeXMLEntities(_ value: String) -> String {
        var output = value
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&apos;", with: "'")
        guard let regex = try? NSRegularExpression(pattern: #"&#(?:x([0-9A-Fa-f]+)|([0-9]+));"#) else {
            return output
        }
        let matches = regex.matches(in: output, range: NSRange(output.startIndex..<output.endIndex, in: output))
        for match in matches.reversed() {
            let scalarValue: UInt32?
            if let hexRange = Range(match.range(at: 1), in: output) {
                scalarValue = UInt32(output[hexRange], radix: 16)
            } else if let decimalRange = Range(match.range(at: 2), in: output) {
                scalarValue = UInt32(output[decimalRange], radix: 10)
            } else {
                scalarValue = nil
            }
            guard let scalarValue, let scalar = UnicodeScalar(scalarValue),
                  let fullRange = Range(match.range(at: 0), in: output) else { continue }
            output.replaceSubrange(fullRange, with: String(scalar))
        }
        return output
    }

    private func replacementFont(for font: String) -> String? {
        let replacements: [String: String] = [
            "calibri": "Carlito",
            "cambria": "Caladea",
            "microsoft jhenghei": "Noto Sans CJK TC",
            "microsoft jhenghei ui": "Noto Sans CJK TC",
            "新細明體": "Noto Serif CJK TC",
            "mingliu": "Noto Serif CJK TC",
            "宋体": "Noto Serif CJK TC",
            "simsun": "Noto Serif CJK TC",
        ]
        return replacements[font.lowercased()]
    }

    private func availableFontNames() -> Set<String> {
        let manager = NSFontManager.shared
        let names = manager.availableFonts + manager.availableFontFamilies
        return Set(names.map { $0.lowercased() })
    }
}
