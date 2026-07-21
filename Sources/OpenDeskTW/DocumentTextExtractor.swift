import Foundation

struct ExtractedDocumentText: Codable {
    let text: String
    let originalCharacterCount: Int
    let truncated: Bool
    let sourceDescription: String
}

struct DocumentTextExtractor: Sendable {
    let maximumCharacters: Int

    init(maximumCharacters: Int = 24_000) {
        self.maximumCharacters = maximumCharacters
    }

    func extract(from url: URL) throws -> ExtractedDocumentText {
        let fileExtension = url.pathExtension.lowercased()
        let extracted: (String, String)
        switch fileExtension {
        case "docx", "docm":
            extracted = (try extractWordXML(from: url), "Word 文件文字與段落")
        case "xlsx", "xlsm":
            extracted = (try extractSpreadsheetXML(from: url), "試算表儲存格、數值與公式")
        case "pptx", "pptm":
            extracted = (try extractPresentationXML(from: url), "簡報投影片文字")
        case "pdf":
            extracted = (try extractPDF(from: url), "PDF 可搜尋文字")
        default:
            extracted = (try extractUsingTextUtil(from: url), "macOS 文件文字轉換")
        }

        let normalized = normalize(extracted.0)
        guard !normalized.isEmpty else {
            throw OpenDeskError.invalidFile("無法從這份文件擷取可供 MAGI 分析的文字；文件可能是掃描影像、加密或沒有文字內容。")
        }
        let truncated = normalized.count > maximumCharacters
        let output = truncated ? String(normalized.prefix(maximumCharacters)) : normalized
        return ExtractedDocumentText(
            text: output,
            originalCharacterCount: normalized.count,
            truncated: truncated,
            sourceDescription: extracted.1
        )
    }

    private func extractWordXML(from url: URL) throws -> String {
        let xml = try unzipEntry("word/document.xml", from: url)
        let paragraphs = regexValues(in: xml, pattern: #"<w:p\b[^>]*>([\s\S]*?)</w:p>"#)
        return paragraphs.map { paragraph in
            let tabsExpanded = paragraph
                .replacingOccurrences(of: #"<w:tab\b[^>]*/>"#, with: "\t", options: .regularExpression)
                .replacingOccurrences(of: #"<w:(?:br|cr)\b[^>]*/>"#, with: "\n", options: .regularExpression)
            return textValues(in: tabsExpanded, tagPattern: "w:t", separator: "")
        }.joined(separator: "\n")
    }

    private func extractPresentationXML(from url: URL) throws -> String {
        let entries = try packageEntries(in: url)
        let slides = entries
            .filter { $0.range(of: #"^ppt/slides/slide[0-9]+\.xml$"#, options: .regularExpression) != nil }
            .sorted(by: naturalLessThan)
        var output: [String] = []
        for (index, entry) in slides.prefix(80).enumerated() {
            let xml = try unzipEntry(entry, from: url)
            let paragraphs = regexValues(in: xml, pattern: #"<a:p\b[^>]*>([\s\S]*?)</a:p>"#)
            let text = paragraphs.map {
                textValues(in: $0, tagPattern: "a:t", separator: "")
            }.joined(separator: "\n")
            if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                output.append("【投影片 \(index + 1)】\n\(text)")
            }
        }
        return output.joined(separator: "\n\n")
    }

    private func extractSpreadsheetXML(from url: URL) throws -> String {
        let entries = try packageEntries(in: url)
        var sharedStrings: [String] = []
        if entries.contains("xl/sharedStrings.xml"),
           let sharedXML = try? unzipEntry("xl/sharedStrings.xml", from: url) {
            sharedStrings = regexValues(in: sharedXML, pattern: #"<si\b[^>]*>([\s\S]*?)</si>"#).map {
                textValues(in: $0, tagPattern: "t", separator: "")
            }
        }

        let sheetNames: [String]
        if let workbook = try? unzipEntry("xl/workbook.xml", from: url) {
            sheetNames = regexValues(in: workbook, pattern: #"<sheet\b[^>]*name=\"([^\"]+)\""#).map(decodeXMLEntities)
        } else {
            sheetNames = []
        }
        let sheets = entries
            .filter { $0.range(of: #"^xl/worksheets/sheet[0-9]+\.xml$"#, options: .regularExpression) != nil }
            .sorted(by: naturalLessThan)
        var output: [String] = []
        for (sheetIndex, entry) in sheets.prefix(40).enumerated() {
            let xml = try unzipEntry(entry, from: url)
            var rows: [String] = []
            let cellBlocks = regexMatches(in: xml, pattern: #"<c\b([^>]*)>([\s\S]*?)</c>"#)
            for groups in cellBlocks.prefix(5_000) where groups.count >= 3 {
                let attributes = groups[1]
                let body = groups[2]
                let reference = firstRegexValue(in: attributes, pattern: #"\br=\"([^\"]+)\""#) ?? "?"
                let type = firstRegexValue(in: attributes, pattern: #"\bt=\"([^\"]+)\""#) ?? ""
                let formula = firstRegexValue(in: body, pattern: #"<f\b[^>]*>([\s\S]*?)</f>"#).map(decodeXMLEntities)
                var value = firstRegexValue(in: body, pattern: #"<v\b[^>]*>([\s\S]*?)</v>"#).map(decodeXMLEntities) ?? ""
                if type == "s", let index = Int(value), sharedStrings.indices.contains(index) {
                    value = sharedStrings[index]
                } else if type == "inlineStr" {
                    value = textValues(in: body, tagPattern: "t", separator: "")
                }
                if !value.isEmpty || formula != nil {
                    let formulaText = formula.map { "　公式：\($0)" } ?? ""
                    rows.append("\(reference)：\(value)\(formulaText)")
                }
            }
            let name = sheetNames.indices.contains(sheetIndex) ? sheetNames[sheetIndex] : "工作表 \(sheetIndex + 1)"
            output.append("【\(name)】\n" + rows.joined(separator: "\n"))
        }
        return output.joined(separator: "\n\n")
    }

    private func extractPDF(from url: URL) throws -> String {
        let candidates = ["/opt/homebrew/bin/pdftotext", "/usr/local/bin/pdftotext", "/usr/bin/pdftotext"]
        guard let executable = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
            throw OpenDeskError.invalidFile("找不到 PDF 文字擷取工具。")
        }
        let result = try ProcessRunner.run(executable: executable, arguments: ["-layout", url.path, "-"])
        guard result.exitCode == 0 else {
            throw OpenDeskError.processFailed(command: "PDF 文字擷取", code: result.exitCode, message: result.standardError)
        }
        return result.standardOutput
    }

    private func extractUsingTextUtil(from url: URL) throws -> String {
        let result = try ProcessRunner.run(
            executable: "/usr/bin/textutil",
            arguments: ["-convert", "txt", "-stdout", url.path]
        )
        guard result.exitCode == 0 else {
            throw OpenDeskError.processFailed(command: "文件文字擷取", code: result.exitCode, message: result.standardError)
        }
        return result.standardOutput
    }

    private func packageEntries(in url: URL) throws -> [String] {
        let result = try ProcessRunner.run(executable: "/usr/bin/unzip", arguments: ["-Z1", url.path])
        guard result.exitCode == 0 else {
            throw OpenDeskError.processFailed(command: "Office 文件結構讀取", code: result.exitCode, message: result.standardError)
        }
        return result.standardOutput.split(separator: "\n").map(String.init)
    }

    private func unzipEntry(_ entry: String, from url: URL) throws -> String {
        let result = try ProcessRunner.run(executable: "/usr/bin/unzip", arguments: ["-p", url.path, entry])
        guard result.exitCode == 0 else {
            throw OpenDeskError.processFailed(command: "Office 文件文字讀取", code: result.exitCode, message: result.standardError)
        }
        return result.standardOutput
    }

    private func textValues(in xml: String, tagPattern: String, separator: String) -> String {
        regexValues(in: xml, pattern: #"<\#(tagPattern)\b[^>]*>([\s\S]*?)</\#(tagPattern)>"#)
            .map(decodeXMLEntities)
            .joined(separator: separator)
    }

    private func regexValues(in text: String, pattern: String) -> [String] {
        regexMatches(in: text, pattern: pattern).compactMap { $0.count > 1 ? $0[1] : nil }
    }

    private func firstRegexValue(in text: String, pattern: String) -> String? {
        regexValues(in: text, pattern: pattern).first
    }

    private func regexMatches(in text: String, pattern: String) -> [[String]] {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return [] }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return regex.matches(in: text, range: range).map { match in
            (0..<match.numberOfRanges).map { index in
                guard let stringRange = Range(match.range(at: index), in: text) else { return "" }
                return String(text[stringRange])
            }
        }
    }

    private func normalize(_ text: String) -> String {
        text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .replacingOccurrences(of: #"[ \t]+\n"#, with: "\n", options: .regularExpression)
            .replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func decodeXMLEntities(_ text: String) -> String {
        var output = text
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&apos;", with: "'")
            .replacingOccurrences(of: "&amp;", with: "&")
        if let regex = try? NSRegularExpression(pattern: #"&#(?:x([0-9A-Fa-f]+)|([0-9]+));"#) {
            let matches = regex.matches(in: output, range: NSRange(output.startIndex..<output.endIndex, in: output))
            for match in matches.reversed() {
                let scalarValue: UInt32?
                if let range = Range(match.range(at: 1), in: output) {
                    scalarValue = UInt32(output[range], radix: 16)
                } else if let range = Range(match.range(at: 2), in: output) {
                    scalarValue = UInt32(output[range], radix: 10)
                } else {
                    scalarValue = nil
                }
                guard let scalarValue, let scalar = UnicodeScalar(scalarValue),
                      let fullRange = Range(match.range(at: 0), in: output) else { continue }
                output.replaceSubrange(fullRange, with: String(scalar))
            }
        }
        return output
    }

    private func naturalLessThan(_ lhs: String, _ rhs: String) -> Bool {
        lhs.compare(rhs, options: [.numeric, .caseInsensitive]) == .orderedAscending
    }
}
