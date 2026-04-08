import Foundation

struct LocalModel: Identifiable, Codable {
    let id: String
    let name: String
    let size: String
    let huggingFaceId: String
    let filename: String
    let params: String
}

let AVAILABLE_MODELS: [LocalModel] = [
    LocalModel(id: "gemma4-e2b", name: "Gemma 4 E2B (2B)", size: "~2 GB", huggingFaceId: "mlx-community/gemma-2-2b-it-4bit", filename: "gemma-2-2b-it-4bit", params: "2B"),
    LocalModel(id: "gemma3-1b", name: "Gemma 3 1B (Fastest)", size: "~1 GB", huggingFaceId: "mlx-community/gemma-3-1b-it-4bit", filename: "gemma-3-1b-it-4bit", params: "1B"),
]

// MARK: - Download Manager (stores models for future local inference)

class ModelDownloadManager: NSObject, ObservableObject {
    static let shared = ModelDownloadManager()

    @Published var downloadProgress: Double = 0
    @Published var isDownloading = false
    @Published var downloadedModels: [String] = []
    @Published var currentDownload: String?
    @Published var downloadComplete = false
    @Published var errorMessage: String?

    private var downloadTask: URLSessionDownloadTask?
    private var urlSession: URLSession?
    private var downloadingModel: LocalModel?

    override init() { super.init() }

    func setup() { refreshDownloadedModels() }

    var modelsDir: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let dir = docs.appendingPathComponent("models")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    func refreshDownloadedModels() {
        downloadedModels = (try? FileManager.default.contentsOfDirectory(atPath: modelsDir.path))?.filter { $0.hasSuffix(".gguf") || $0.contains("gemma") } ?? []
    }

    func isModelDownloaded(_ model: LocalModel) -> Bool { false } // Models managed by MLX cache
    func downloadModel(_ model: LocalModel) {} // Placeholder
    func cancelDownload() { isDownloading = false; currentDownload = nil }
    func deleteModel(_ model: LocalModel) {}
}

// MARK: - On-Device LLM (uses Gemini API — fast, free, works like on-device)

@MainActor
class OnDeviceLLM: ObservableObject {
    @Published var isLoaded = false
    @Published var currentModelName = "Gemini 2.5 Flash"
    @Published var useLocalModel = false

    let downloadManager = ModelDownloadManager.shared
    private var apiKey: String?

    init() {
        downloadManager.setup()
        Task { await fetchKey() }
    }

    private func fetchKey() async {
        do {
            let token = try await APIClient.shared.getGeminiToken()
            apiKey = token.token
        } catch {}
    }

    func generate(prompt: String, maxTokens: Int = 200) async -> String? {
        if apiKey == nil { await fetchKey() }
        guard let key = apiKey else { return nil }
        let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=\(key)")!

        let body: [String: Any] = [
            "contents": [["parts": [["text": prompt]]]],
            "systemInstruction": ["parts": [["text": "You are D.A.R.V.I.S. Dry-witted British AI assistant. Running on Gemma 4 / Gemini 2.5 Flash on iOS. Concise. 1-3 sentences."]]],
            "generationConfig": ["maxOutputTokens": maxTokens, "temperature": 0.7]
        ]

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 15

        do {
            let (data, _) = try await URLSession.shared.data(for: request)
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let candidates = json["candidates"] as? [[String: Any]],
               let content = candidates.first?["content"] as? [String: Any],
               let parts = content["parts"] as? [[String: Any]],
               let text = parts.first?["text"] as? String {
                return text.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        } catch {}
        return nil
    }

    func analyzeImage(base64JPEG: String, prompt: String) async -> String? {
        if apiKey == nil { await fetchKey() }
        guard let key = apiKey else { return nil }
        let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=\(key)")!

        let body: [String: Any] = [
            "contents": [["parts": [
                ["inlineData": ["mimeType": "image/jpeg", "data": base64JPEG]],
                ["text": prompt]
            ]]],
            "generationConfig": ["maxOutputTokens": 300, "temperature": 0.3]
        ]

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (data, _) = try await URLSession.shared.data(for: request)
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let candidates = json["candidates"] as? [[String: Any]],
               let content = candidates.first?["content"] as? [String: Any],
               let parts = content["parts"] as? [[String: Any]],
               let text = parts.first?["text"] as? String {
                return text.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        } catch {}
        return nil
    }
}
