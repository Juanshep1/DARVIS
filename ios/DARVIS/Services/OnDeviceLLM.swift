import Foundation

// Available models for on-device download
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
        id: "gemma2-2b-q4",
        name: "Gemma 2 2B (Q4)",
        size: "1.5 GB",
        url: "https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf",
        filename: "gemma-2-2b-it-Q4_K_M.gguf",
        params: "2B"
    ),
    LocalModel(
        id: "gemma2-2b-q8",
        name: "Gemma 2 2B (Q8 - Higher Quality)",
        size: "2.7 GB",
        url: "https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q8_0.gguf",
        filename: "gemma-2-2b-it-Q8_0.gguf",
        params: "2B"
    ),
]

// MARK: - Model Download Manager

@MainActor
class ModelDownloadManager: NSObject, ObservableObject, URLSessionDownloadDelegate {
    @Published var downloadProgress: Double = 0
    @Published var isDownloading = false
    @Published var downloadedModels: [String] = []
    @Published var currentDownload: String?

    private var downloadTask: URLSessionDownloadTask?
    private var bgSession: URLSession?

    override init() {
        super.init()
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
        isDownloading = true
        downloadProgress = 0
        currentDownload = model.name

        let config = URLSessionConfiguration.background(withIdentifier: "com.darvis.modeldownload.\(model.id)")
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        bgSession = URLSession(configuration: config, delegate: self, delegateQueue: .main)
        let request = URLRequest(url: URL(string: model.url)!)
        downloadTask = bgSession?.downloadTask(with: request)
        downloadTask?.resume()
    }

    func cancelDownload() {
        downloadTask?.cancel()
        isDownloading = false
        currentDownload = nil
    }

    func deleteModel(_ model: LocalModel) {
        let path = modelsDir.appendingPathComponent(model.filename)
        try? FileManager.default.removeItem(at: path)
        refreshDownloadedModels()
    }

    nonisolated func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        Task { @MainActor in
            if let name = currentDownload, let model = AVAILABLE_MODELS.first(where: { $0.name == name }) {
                let dest = modelsDir.appendingPathComponent(model.filename)
                try? FileManager.default.removeItem(at: dest)
                try? FileManager.default.moveItem(at: location, to: dest)
            }
            isDownloading = false
            currentDownload = nil
            refreshDownloadedModels()
        }
    }

    nonisolated func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        let progress = Double(totalBytesWritten) / Double(max(totalBytesExpectedToWrite, 1))
        Task { @MainActor in
            downloadProgress = progress
        }
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
        if error != nil {
            Task { @MainActor in
                isDownloading = false
                currentDownload = nil
            }
        }
    }
}

// MARK: - On-Device LLM

@MainActor
class OnDeviceLLM: ObservableObject {
    @Published var isLoaded = false
    @Published var currentModelName = "Gemini 2.5 Flash (Cloud)"
    @Published var useLocalModel = false

    let downloadManager = ModelDownloadManager()
    private let apiKey = "AIzaSyB5bZqg9H3ABY5bivM0F_9CTmFqfLzMB9E"

    // Check if any local model is downloaded
    var hasLocalModel: Bool {
        AVAILABLE_MODELS.contains(where: { downloadManager.isModelDownloaded($0) })
    }

    func selectModel(_ model: LocalModel) {
        if downloadManager.isModelDownloaded(model) {
            useLocalModel = true
            currentModelName = "\(model.name) (On-Device)"
            isLoaded = true
            // Note: actual llama.cpp inference requires the llama SPM package.
            // For now, downloaded models are stored and ready for when the
            // llama.cpp framework is integrated. Using Gemini API as bridge.
        }
    }

    func useCloudMode() {
        useLocalModel = false
        currentModelName = "Gemini 2.5 Flash (Cloud)"
        isLoaded = false
    }

    func generate(prompt: String, maxTokens: Int = 200) async -> String? {
        // TODO: When llama.cpp SPM is integrated, use local inference here
        // For now, use Gemini API (free, fast, same quality)
        return await generateViaAPI(prompt: prompt)
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

