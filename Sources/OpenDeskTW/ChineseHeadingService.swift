import Foundation

struct ChineseHeadingService {
    private struct HeadingMatch {
        let level: Int
        let prefix: String
        let numeral: String
    }

    func detect(in sourceURL: URL) throws -> [DetectedHeading] {
        guard ["docx", "docm"].contains(sourceURL.pathExtension.lowercased()) else { return [] }
        return detect(inDocumentXML: try documentXML(from: sourceURL))
    }

    func createRenumberedCopy(of sourceURL: URL) throws -> URL {
        guard ["docx", "docm"].contains(sourceURL.pathExtension.lowercased()) else {
            throw OpenDeskError.invalidFile("中文標題重新編號目前支援 DOCX／DOCM 文件。")
        }

        let fileManager = FileManager.default
        let temporaryFolder = fileManager.temporaryDirectory
            .appendingPathComponent("OpenDeskTW-Heading-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(at: temporaryFolder, withIntermediateDirectories: true)
        defer { try? fileManager.removeItem(at: temporaryFolder) }

        let unzipResult = try ProcessRunner.run(
            executable: "/usr/bin/unzip",
            arguments: ["-qq", sourceURL.path, "-d", temporaryFolder.path]
        )
        guard unzipResult.exitCode == 0 else {
            throw OpenDeskError.processFailed(
                command: "DOCX 解壓縮",
                code: unzipResult.exitCode,
                message: unzipResult.standardError
            )
        }

        let documentURL = temporaryFolder.appendingPathComponent("word/document.xml")
        let xml = try String(contentsOf: documentURL, encoding: .utf8)
        let renumbered = try renumber(documentXML: xml)
        guard renumbered.headingCount > 0 else {
            throw OpenDeskError.invalidFile("這份文件沒有在段落開頭偵測到「壹、」、「一、」、「（一）」或「1.」等標題編號。")
        }
        try renumbered.xml.write(to: documentURL, atomically: true, encoding: .utf8)

        let destination = uniqueDestination(for: sourceURL)
        let zipResult = try ProcessRunner.run(
            executable: "/usr/bin/zip",
            arguments: ["-q", "-r", destination.path, "."],
            currentDirectoryURL: temporaryFolder
        )
        guard zipResult.exitCode == 0 else {
            throw OpenDeskError.processFailed(
                command: "DOCX 重新封裝",
                code: zipResult.exitCode,
                message: zipResult.standardError
            )
        }
        return destination
    }

    private func documentXML(from sourceURL: URL) throws -> String {
        let result = try ProcessRunner.run(
            executable: "/usr/bin/unzip",
            arguments: ["-p", sourceURL.path, "word/document.xml"]
        )
        guard result.exitCode == 0, !result.standardOutput.isEmpty else {
            throw OpenDeskError.invalidFile("無法讀取 DOCX 的 word/document.xml。")
        }
        return result.standardOutput
    }

    private func detect(inDocumentXML xml: String) -> [DetectedHeading] {
        guard let paragraphRegex = try? NSRegularExpression(
            pattern: #"<w:p(?:\s[^>]*)?>[\s\S]*?</w:p>"#,
            options: [.caseInsensitive]
        ) else { return [] }
        let range = NSRange(xml.startIndex..<xml.endIndex, in: xml)
        return paragraphRegex.matches(in: xml, range: range).enumerated().compactMap { index, result in
            guard let paragraphRange = Range(result.range, in: xml) else { return nil }
            let text = paragraphText(from: String(xml[paragraphRange]))
            guard let heading = headingMatch(in: text) else { return nil }
            return DetectedHeading(
                paragraphNumber: index + 1,
                level: heading.level,
                prefix: heading.prefix,
                text: text
            )
        }
    }

    private func renumber(documentXML xml: String) throws -> (xml: String, headingCount: Int) {
        let paragraphRegex = try NSRegularExpression(
            pattern: #"<w:p(?:\s[^>]*)?>[\s\S]*?</w:p>"#,
            options: [.caseInsensitive]
        )
        let fullRange = NSRange(xml.startIndex..<xml.endIndex, in: xml)
        let paragraphMatches = paragraphRegex.matches(in: xml, range: fullRange)
        var counters = [1: 0, 2: 0, 3: 0, 4: 0]
        var replacements: [(NSRange, String)] = []

        for paragraphResult in paragraphMatches {
            guard let paragraphRange = Range(paragraphResult.range, in: xml) else { continue }
            let paragraph = String(xml[paragraphRange])
            guard let heading = headingMatch(in: paragraphText(from: paragraph)) else { continue }

            counters[heading.level, default: 0] += 1
            if heading.level < 4 {
                for lowerLevel in (heading.level + 1)...4 {
                    counters[lowerLevel] = 0
                }
            }

            let nextNumber = counters[heading.level, default: 1]
            let replacementNumeral: String
            switch heading.level {
            case 1: replacementNumeral = chineseNumber(nextNumber, financial: true)
            case 2, 3: replacementNumeral = chineseNumber(nextNumber, financial: false)
            default: replacementNumeral = String(nextNumber)
            }

            var newPrefix = heading.prefix
            if let numeralRange = newPrefix.range(of: heading.numeral) {
                newPrefix.replaceSubrange(numeralRange, with: replacementNumeral)
            }
            var updatedParagraph = replaceTextPrefix(
                in: paragraph,
                oldPrefix: heading.prefix,
                newPrefix: newPrefix
            )
            updatedParagraph = applyHeadingStyle(to: updatedParagraph, level: heading.level)
            replacements.append((paragraphResult.range, updatedParagraph))
        }

        var output = xml
        for (range, replacement) in replacements.reversed() {
            guard let stringRange = Range(range, in: output) else { continue }
            output.replaceSubrange(stringRange, with: replacement)
        }
        return (output, replacements.count)
    }

    private func headingMatch(in text: String) -> HeadingMatch? {
        let patterns: [(Int, String)] = [
            (1, #"^\s*([壹貳參肆伍陸柒捌玖拾佰]+)、"#),
            (1, #"^\s*[〔【\[]([壹貳參肆伍陸柒捌玖拾佰]+)、[〕】\]]"#),
            (2, #"^\s*([一二三四五六七八九十百]+)、"#),
            (2, #"^\s*[〔【\[]([一二三四五六七八九十百]+)、[〕】\]]"#),
            (3, #"^\s*[（(]([一二三四五六七八九十百]+)[）)]"#),
            (3, #"^\s*[〔【]([一二三四五六七八九十百]+)[〕】]"#),
            (4, #"^\s*([0-9]+)[、\.．]"#),
        ]
        let fullRange = NSRange(text.startIndex..<text.endIndex, in: text)
        for (level, pattern) in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern),
                  let result = regex.firstMatch(in: text, range: fullRange),
                  let prefixRange = Range(result.range(at: 0), in: text),
                  let numeralRange = Range(result.range(at: 1), in: text) else { continue }
            return HeadingMatch(
                level: level,
                prefix: String(text[prefixRange]),
                numeral: String(text[numeralRange])
            )
        }
        return nil
    }

    private func paragraphText(from paragraph: String) -> String {
        guard let textRegex = try? NSRegularExpression(
            pattern: #"<w:t\b[^>]*>([\s\S]*?)</w:t>"#,
            options: [.caseInsensitive]
        ) else { return "" }
        let range = NSRange(paragraph.startIndex..<paragraph.endIndex, in: paragraph)
        return textRegex.matches(in: paragraph, range: range).compactMap { result in
            guard let contentRange = Range(result.range(at: 1), in: paragraph) else { return nil }
            return decodeXMLText(String(paragraph[contentRange]))
        }.joined()
    }

    private func replaceTextPrefix(in paragraph: String, oldPrefix: String, newPrefix: String) -> String {
        guard let textRegex = try? NSRegularExpression(
            pattern: #"<w:t\b[^>]*>([\s\S]*?)</w:t>"#,
            options: [.caseInsensitive]
        ) else { return paragraph }
        let fullRange = NSRange(paragraph.startIndex..<paragraph.endIndex, in: paragraph)
        let matches = textRegex.matches(in: paragraph, range: fullRange)
        guard paragraphText(from: paragraph).hasPrefix(oldPrefix) else { return paragraph }

        var remainingToRemove = oldPrefix.count
        var inserted = false
        var replacements: [(NSRange, String)] = []
        for match in matches where remainingToRemove > 0 {
            guard let contentRange = Range(match.range(at: 1), in: paragraph) else { continue }
            let decoded = decodeXMLText(String(paragraph[contentRange]))
            let removeCount = min(remainingToRemove, decoded.count)
            let suffix = String(decoded.dropFirst(removeCount))
            let replacement = (inserted ? "" : newPrefix) + suffix
            replacements.append((match.range(at: 1), encodeXMLText(replacement)))
            inserted = true
            remainingToRemove -= removeCount
        }

        guard remainingToRemove == 0 else { return paragraph }
        var output = paragraph
        for (range, replacement) in replacements.reversed() {
            guard let stringRange = Range(range, in: output) else { continue }
            output.replaceSubrange(stringRange, with: replacement)
        }
        return output
    }

    private func applyHeadingStyle(to paragraph: String, level: Int) -> String {
        let style = #"<w:pStyle w:val="Heading\#(level)"/>"#
        if let styleRegex = try? NSRegularExpression(pattern: #"<w:pStyle\b[^>]*/>"#),
           let match = styleRegex.firstMatch(
               in: paragraph,
               range: NSRange(paragraph.startIndex..<paragraph.endIndex, in: paragraph)
           ), let range = Range(match.range, in: paragraph) {
            var output = paragraph
            output.replaceSubrange(range, with: style)
            return output
        }
        if let propertiesRegex = try? NSRegularExpression(pattern: #"<w:pPr(?:\s[^>]*)?>"#),
           let match = propertiesRegex.firstMatch(
               in: paragraph,
               range: NSRange(paragraph.startIndex..<paragraph.endIndex, in: paragraph)
           ), let range = Range(match.range, in: paragraph) {
            var output = paragraph
            output.insert(contentsOf: style, at: range.upperBound)
            return output
        }
        guard let openingEnd = paragraph.firstIndex(of: ">") else { return paragraph }
        var output = paragraph
        output.insert(contentsOf: "<w:pPr>\(style)</w:pPr>", at: paragraph.index(after: openingEnd))
        return output
    }

    private func chineseNumber(_ number: Int, financial: Bool) -> String {
        let digits = financial
            ? ["零", "壹", "貳", "參", "肆", "伍", "陸", "柒", "捌", "玖"]
            : ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"]
        let ten = financial ? "拾" : "十"
        if number < 10 { return digits[number] }
        if number < 20 { return ten + (number == 10 ? "" : digits[number % 10]) }
        if number < 100 {
            return digits[number / 10] + ten + (number % 10 == 0 ? "" : digits[number % 10])
        }
        return String(number)
    }

    private func decodeXMLText(_ text: String) -> String {
        text
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&apos;", with: "'")
            .replacingOccurrences(of: "&amp;", with: "&")
    }

    private func encodeXMLText(_ text: String) -> String {
        text
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }

    private func uniqueDestination(for sourceURL: URL) -> URL {
        let folder = sourceURL.deletingLastPathComponent()
        let base = sourceURL.deletingPathExtension().lastPathComponent
        let ext = sourceURL.pathExtension
        let preferred = folder.appendingPathComponent("\(base)-重新編號").appendingPathExtension(ext)
        if !FileManager.default.fileExists(atPath: preferred.path) { return preferred }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return folder
            .appendingPathComponent("\(base)-重新編號-\(formatter.string(from: Date()))")
            .appendingPathExtension(ext)
    }
}
