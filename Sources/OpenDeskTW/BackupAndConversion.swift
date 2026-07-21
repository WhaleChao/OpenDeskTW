import AppKit
import CryptoKit
import Foundation

struct BackupManager {
    let maximumVersions: Int
    let retentionDays: Int

    init(maximumVersions: Int = 20, retentionDays: Int = 30) {
        self.maximumVersions = maximumVersions
        self.retentionDays = retentionDays
    }

    var rootURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("OpenDesk TW/Backups", isDirectory: true)
    }

    func createBackup(of sourceURL: URL) throws -> URL {
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: rootURL, withIntermediateDirectories: true)

        let documentKey = stableKey(for: sourceURL.path)
        let documentFolder = rootURL.appendingPathComponent(documentKey, isDirectory: true)
        try fileManager.createDirectory(at: documentFolder, withIntermediateDirectories: true)

        let stamp = Self.fileTimestamp.string(from: Date())
        let destination = documentFolder.appendingPathComponent("\(stamp)-\(sourceURL.lastPathComponent)")
        try fileManager.copyItem(at: sourceURL, to: destination)
        try prune(documentFolder: documentFolder)
        return destination
    }

    func createSafeCopy(of sourceURL: URL) throws -> URL {
        let fileManager = FileManager.default
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let safeFolder = base.appendingPathComponent("OpenDesk TW/Safe Copies/\(Self.folderTimestamp.string(from: Date()))", isDirectory: true)
        try fileManager.createDirectory(at: safeFolder, withIntermediateDirectories: true)
        let destination = safeFolder.appendingPathComponent(sourceURL.lastPathComponent)
        try fileManager.copyItem(at: sourceURL, to: destination)
        try fileManager.setAttributes([.posixPermissions: 0o444], ofItemAtPath: destination.path)
        return destination
    }

    private func stableKey(for path: String) -> String {
        let digest = SHA256.hash(data: Data(path.utf8))
        return digest.prefix(10).map { String(format: "%02x", $0) }.joined()
    }

    private func prune(documentFolder: URL) throws {
        let fileManager = FileManager.default
        let keys: Set<URLResourceKey> = [.contentModificationDateKey, .isRegularFileKey]
        let files = try fileManager.contentsOfDirectory(
            at: documentFolder,
            includingPropertiesForKeys: Array(keys),
            options: [.skipsHiddenFiles]
        ).filter { url in
            (try? url.resourceValues(forKeys: keys).isRegularFile) == true
        }.sorted { lhs, rhs in
            let leftDate = (try? lhs.resourceValues(forKeys: keys).contentModificationDate) ?? .distantPast
            let rightDate = (try? rhs.resourceValues(forKeys: keys).contentModificationDate) ?? .distantPast
            return leftDate > rightDate
        }

        let cutoff = Calendar.current.date(byAdding: .day, value: -retentionDays, to: Date()) ?? .distantPast
        for (index, fileURL) in files.enumerated() {
            let modified = (try? fileURL.resourceValues(forKeys: keys).contentModificationDate) ?? .distantPast
            if index >= maximumVersions || modified < cutoff {
                try? fileManager.removeItem(at: fileURL)
            }
        }
    }

    private static let fileTimestamp: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss-SSS"
        return formatter
    }()

    private static let folderTimestamp: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter
    }()
}

struct PDFConverter {
    var exportRootURL: URL {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return documents.appendingPathComponent("OpenDesk TW Exports", isDirectory: true)
    }

    func convert(sourceURL: URL, destinationRoot: URL? = nil) throws -> URL {
        guard sourceURL.pathExtension.lowercased() != "pdf" else {
            throw OpenDeskError.unsupportedPDFSource
        }
        let executable = EngineLocator.executableURL(for: .libreOffice)
        guard FileManager.default.fileExists(atPath: executable.path) else {
            throw OpenDeskError.missingEngine(.libreOffice)
        }

        let root = destinationRoot ?? exportRootURL
        let stamp = Self.folderTimestamp.string(from: Date())
        let outputFolder = root.appendingPathComponent("\(sourceURL.deletingPathExtension().lastPathComponent)-\(stamp)", isDirectory: true)
        try FileManager.default.createDirectory(at: outputFolder, withIntermediateDirectories: true)

        let profileFolder = FileManager.default.temporaryDirectory
            .appendingPathComponent("OpenDeskTW-LO-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: profileFolder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: profileFolder) }

        let result = try ProcessRunner.run(
            executable: executable.path,
            arguments: [
                "-env:UserInstallation=\(profileFolder.absoluteString)",
                "--headless",
                "--convert-to", "pdf",
                "--outdir", outputFolder.path,
                sourceURL.path
            ]
        )
        guard result.exitCode == 0 else {
            throw OpenDeskError.processFailed(
                command: "LibreOffice PDF",
                code: result.exitCode,
                message: result.standardError.isEmpty ? result.standardOutput : result.standardError
            )
        }

        let expected = outputFolder.appendingPathComponent(sourceURL.deletingPathExtension().lastPathComponent).appendingPathExtension("pdf")
        guard FileManager.default.fileExists(atPath: expected.path) else {
            throw OpenDeskError.outputMissing(expected.path)
        }
        return expected
    }

    private static let folderTimestamp: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter
    }()
}

enum FinderService {
    static func reveal(_ url: URL) {
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }
}
