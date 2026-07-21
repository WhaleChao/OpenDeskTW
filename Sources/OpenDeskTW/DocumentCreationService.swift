import Foundation

struct DocumentTemplateService {
    func createCopy(of type: NewDocumentType, at destinationURL: URL) throws {
        let fileManager = FileManager.default
        guard let templateURL = Bundle.main.url(
            forResource: type.templateBaseName,
            withExtension: type.fileExtension,
            subdirectory: "Templates"
        ) else {
            throw OpenDeskError.outputMissing("內建\(type.displayName)範本（\(type.templateBaseName).\(type.fileExtension)）")
        }

        let destination = destinationURL.pathExtension.isEmpty
            ? destinationURL.appendingPathExtension(type.fileExtension)
            : destinationURL
        let temporaryURL = destination.deletingLastPathComponent()
            .appendingPathComponent(".OpenDeskTW-\(UUID().uuidString)")
            .appendingPathExtension(type.fileExtension)

        try fileManager.copyItem(at: templateURL, to: temporaryURL)
        do {
            if fileManager.fileExists(atPath: destination.path) {
                _ = try fileManager.replaceItemAt(destination, withItemAt: temporaryURL)
            } else {
                try fileManager.moveItem(at: temporaryURL, to: destination)
            }
        } catch {
            try? fileManager.removeItem(at: temporaryURL)
            throw error
        }
    }

    func templateURL(for type: NewDocumentType) throws -> URL {
        guard let url = Bundle.main.url(
            forResource: type.templateBaseName,
            withExtension: type.fileExtension,
            subdirectory: "Templates"
        ) else {
            throw OpenDeskError.outputMissing("內建\(type.displayName)範本")
        }
        return url
    }
}

struct RecentDocumentStore {
    private let maximumCount = 12

    private var storeURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("OpenDesk TW", isDirectory: true)
            .appendingPathComponent("recent-documents.json")
    }

    func load() -> [RecentDocumentRecord] {
        guard let data = try? Data(contentsOf: storeURL),
              let decoded = try? JSONDecoder().decode([RecentDocumentRecord].self, from: data) else {
            return []
        }
        let existing = decoded.filter { FileManager.default.fileExists(atPath: $0.path) }
        if existing.count != decoded.count {
            try? save(existing)
        }
        return Array(existing.sorted { $0.lastOpened > $1.lastOpened }.prefix(maximumCount))
    }

    func record(_ url: URL, kind: DocumentKind, in records: [RecentDocumentRecord]) -> [RecentDocumentRecord] {
        let path = url.standardizedFileURL.path
        var updated = records.filter { $0.path != path && FileManager.default.fileExists(atPath: $0.path) }
        updated.insert(RecentDocumentRecord(path: path, kind: kind, lastOpened: Date()), at: 0)
        updated = Array(updated.prefix(maximumCount))
        try? save(updated)
        return updated
    }

    func remove(_ record: RecentDocumentRecord, from records: [RecentDocumentRecord]) -> [RecentDocumentRecord] {
        let updated = records.filter { $0.id != record.id }
        try? save(updated)
        return updated
    }

    func clear() -> [RecentDocumentRecord] {
        try? save([])
        return []
    }

    private func save(_ records: [RecentDocumentRecord]) throws {
        let folder = storeURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(records).write(to: storeURL, options: .atomic)
    }
}
