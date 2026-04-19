import Foundation

/// On-device persistence for memory, history, settings, and wiki.
/// Replaces Netlify Blobs so the iOS app runs without a backend.
///
/// Everything serializes to JSON files inside the app's Documents directory.
/// Lightweight — we're storing at most a few hundred KB per file.
enum LocalStore {
    private static let fileManager = FileManager.default

    private static var docsDir: URL {
        fileManager.urls(for: .documentDirectory, in: .userDomainMask).first!
    }

    private static func url(for name: String) -> URL {
        docsDir.appendingPathComponent("spectra.\(name).json")
    }

    // MARK: - Generic JSON helpers

    static func readJSON<T: Decodable>(_ name: String, as type: T.Type) -> T? {
        let u = url(for: name)
        guard let data = try? Data(contentsOf: u) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    static func writeJSON<T: Encodable>(_ name: String, _ value: T) {
        let u = url(for: name)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        if let data = try? encoder.encode(value) {
            try? data.write(to: u, options: .atomic)
        }
    }

    static func delete(_ name: String) {
        try? fileManager.removeItem(at: url(for: name))
    }

    // MARK: - Memory

    static func loadMemories() -> [Memory] {
        return readJSON("memory", as: [Memory].self) ?? []
    }

    static func saveMemories(_ m: [Memory]) {
        writeJSON("memory", m)
    }

    static func addMemory(content: String, category: String = "general") -> Memory {
        var all = loadMemories()
        let nextId = (all.map { $0.id }.max() ?? -1) + 1
        let m = Memory(
            id: nextId,
            content: content,
            category: category,
            created: ISO8601DateFormatter().string(from: Date())
        )
        all.append(m)
        saveMemories(all)
        return m
    }

    static func deleteMemory(id: Int) {
        var all = loadMemories()
        all.removeAll { $0.id == id }
        // Reindex so new adds don't clash
        for i in 0..<all.count {
            all[i] = Memory(id: i, content: all[i].content, category: all[i].category, created: all[i].created)
        }
        saveMemories(all)
    }

    // MARK: - History

    static func loadHistory() -> [ChatMessage] {
        return readJSON("history", as: [ChatMessage].self) ?? []
    }

    static func saveHistory(_ h: [ChatMessage]) {
        // Cap at 200 entries to keep the file small
        let capped = h.count > 200 ? Array(h.suffix(200)) : h
        writeJSON("history", capped)
    }

    static func appendHistory(_ msgs: [ChatMessage]) {
        var all = loadHistory()
        all.append(contentsOf: msgs)
        saveHistory(all)
    }

    static func clearHistory() {
        writeJSON("history", [ChatMessage]())
    }

    // MARK: - Settings

    static func loadSettings() -> AppSettings {
        return readJSON("settings", as: AppSettings.self)
            ?? AppSettings(model: APIKeys.defaultOllamaModel, voice_id: "", audio_mode: "classic")
    }

    static func saveSettings(_ s: AppSettings) {
        writeJSON("settings", s)
    }

    // MARK: - Wiki (minimal — title + content pages)

    struct WikiPage: Codable, Identifiable {
        let id: String
        var title: String
        var content: String
        var type: String
        var tags: [String]
        var summary: String
        var updated: String
    }

    static func loadWikiPages() -> [WikiPage] {
        return readJSON("wiki", as: [WikiPage].self) ?? []
    }

    static func saveWikiPages(_ pages: [WikiPage]) {
        writeJSON("wiki", pages)
    }

    static func upsertWikiPage(_ p: WikiPage) {
        var all = loadWikiPages()
        if let i = all.firstIndex(where: { $0.id == p.id }) {
            all[i] = p
        } else {
            all.append(p)
        }
        saveWikiPages(all)
    }
}
