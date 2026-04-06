import Foundation

// Available Gemma 4 models for on-device download
struct LocalModel: Identifiable, Codable {
    let id: String
    let name: String
    let size: String
    let url: String
    let filename: String
    let params: String
}

let AVAILABLE_MODELS: [LocalModel] = [
    LocalModel(
        id: "gemma4-e2b-q4",
        name: "Gemma 4 E2B (Q4 - Recommended)",
        size: "3.1 GB",
        url: "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf",
        filename: "gemma-4-E2B-it-Q4_K_M.gguf",
        params: "2B"
    ),
    LocalModel(
        id: "gemma4-e2b-q8",
        name: "Gemma 4 E2B (Q8 - Best Quality)",
        size: "5.0 GB",
        url: "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q8_0.gguf",
        filename: "gemma-4-E2B-it-Q8_0.gguf",
        params: "2B"
    ),
    LocalModel(
        id: "gemma4-e4b-q4",
        name: "Gemma 4 E4B (Q4 - Larger Model)",
        size: "5.0 GB",
        url: "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf",
        filename: "gemma-4-E4B-it-Q4_K_M.gguf",
        params: "4B"
    ),
]

// MARK: - Model Download Manager

class ModelDownloadManager: NSObject, ObservableObject, URLSessionDownloadDelegate {
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

    override init() {
        super.init()
    }

    // Called separately since we can't use self in super.init delegate
    func setup() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 300
        urlSession = URLSession(configuration: config, delegate: self, delegateQueue: .main)
        refreshDownloadedModels()
    }

    var modelsDir: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let dir = docs.appendingPathComponent("models")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    func refreshDownloadedModels() {
        let files = (try? FileManager.default.contentsOfDirectory(atPath: modelsDir.path)) ?? []
        downloadedModels = files.filter { $0.hasSuffix(".gguf") }
    }

    func isModelDownloaded(_ model: LocalModel) -> Bool {
        FileManager.default.fileExists(atPath: modelsDir.appendingPathComponent(model.filename).path)
    }

    func modelPath(_ model: LocalModel) -> String? {
        let path = modelsDir.appendingPathComponent(model.filename).path
        return FileManager.default.fileExists(atPath: path) ? path : nil
    }

    func downloadModel(_ model: LocalModel) {
        guard !isDownloading else { return }

        if urlSession == nil { setup() }

        isDownloading = true
        downloadProgress = 0
        downloadComplete = false
        errorMessage = nil
        currentDownload = model.name
        downloadingModel = model

        guard let url = URL(string: model.url) else {
            errorMessage = "Invalid URL"
            isDownloading = false
            return
        }

        downloadTask = urlSession?.downloadTask(with: url)
        downloadTask?.resume()
    }

    func cancelDownload() {
        downloadTask?.cancel()
        isDownloading = false
        currentDownload = nil
        downloadingModel = nil
    }

    func deleteModel(_ model: LocalModel) {
        let path = modelsDir.appendingPathComponent(model.filename)
        try? FileManager.default.removeItem(at: path)
        refreshDownloadedModels()
    }

    // MARK: - URLSessionDownloadDelegate

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let model = downloadingModel else { return }
        let dest = modelsDir.appendingPathComponent(model.filename)
        do {
            try? FileManager.default.removeItem(at: dest)
            try FileManager.default.moveItem(at: location, to: dest)
            DispatchQueue.main.async {
                self.isDownloading = false
                self.downloadComplete = true
                self.currentDownload = nil
                self.downloadingModel = nil
                self.refreshDownloadedModels()
            }
        } catch {
            DispatchQueue.main.async {
                self.errorMessage = "Failed to save: \(error.localizedDescription)"
                self.isDownloading = false
            }
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        let progress = Double(totalBytesWritten) / Double(max(totalBytesExpectedToWrite, 1))
        DispatchQueue.main.async {
            self.downloadProgress = progress
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
        if let error = error {
            DispatchQueue.main.async {
                self.errorMessage = error.localizedDescription
                self.isDownloading = false
                self.currentDownload = nil
                self.downloadingModel = nil
            }
        }
    }
}

// MARK: - On-Device LLM

@MainActor
class OnDeviceLLM: ObservableObject {
    @Published var isLoaded = false
    @Published var currentModelName = "Cloud (Gemini 2.5 Flash)"
    @Published var useLocalModel = false

    let downloadManager = ModelDownloadManager.shared
    private let apiKey = "AIzaSyB5bZqg9H3ABY5bivM0F_9CTmFqfLzMB9E"

    init() {
        downloadManager.setup()
    }

    var hasLocalModel: Bool {
        AVAILABLE_MODELS.contains(where: { downloadManager.isModelDownloaded($0) })
    }

    func generate(prompt: String, maxTokens: Int = 200) async -> String? {
        return await generateViaAPI(prompt: prompt, maxTokens: maxTokens)
    }

    private func generateViaAPI(prompt: String, maxTokens: Int = 200) async -> String? {
        let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=\(apiKey)")!

        let body: [String: Any] = [
            "contents": [["parts": [["text": prompt]]]],
            "systemInstruction": ["parts": [["text": "You are DARVIS, a dry-witted British AI assistant. Be concise. 1-2 sentences."]]],
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
        let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=\(apiKey)")!

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
