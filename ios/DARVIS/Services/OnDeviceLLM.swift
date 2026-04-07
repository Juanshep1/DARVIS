import Foundation
import MLXLLM
import MLXLMCommon

// Available Gemma 4 models for on-device download via MLX
struct LocalModel: Identifiable, Codable {
    let id: String
    let name: String
    let size: String
    let huggingFaceId: String  // MLX model ID on HuggingFace
    let filename: String
    let params: String
}

let AVAILABLE_MODELS: [LocalModel] = [
    LocalModel(
        id: "gemma4-e2b",
        name: "Gemma 4 E2B (2B - Recommended)",
        size: "~2 GB",
        huggingFaceId: "mlx-community/gemma-2-2b-it-4bit",
        filename: "gemma-2-2b-it-4bit",
        params: "2B"
    ),
    LocalModel(
        id: "gemma3-1b",
        name: "Gemma 3 1B (Fastest)",
        size: "~1 GB",
        huggingFaceId: "mlx-community/gemma-3-1b-it-4bit",
        filename: "gemma-3-1b-it-4bit",
        params: "1B"
    ),
]

// MARK: - Model Download Manager

class ModelDownloadManager: NSObject, ObservableObject {
    static let shared = ModelDownloadManager()

    @Published var downloadProgress: Double = 0
    @Published var isDownloading = false
    @Published var downloadedModels: [String] = []
    @Published var currentDownload: String?
    @Published var downloadComplete = false
    @Published var errorMessage: String?

    override init() {
        super.init()
    }

    func setup() {
        // MLX handles model caching automatically
        downloadedModels = []
    }

    func isModelDownloaded(_ model: LocalModel) -> Bool {
        // MLX caches models in its own directory
        // We check by trying to see if the model config exists
        let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
            .appendingPathComponent("huggingface/models/\(model.huggingFaceId.replacingOccurrences(of: "/", with: "--"))")
        return FileManager.default.fileExists(atPath: cacheDir.path)
    }

    func downloadModel(_ model: LocalModel) {
        guard !isDownloading else { return }
        isDownloading = true
        downloadProgress = 0
        currentDownload = model.name
        errorMessage = nil
        downloadComplete = false

        Task {
            do {
                // MLX downloads and caches the model automatically when you load it
                let config = ModelConfiguration(id: model.huggingFaceId)
                _ = try await LLMModelFactory.shared.loadContainer(configuration: config) { progress in
                    Task { @MainActor in
                        self.downloadProgress = progress.fractionCompleted
                    }
                }
                await MainActor.run {
                    isDownloading = false
                    downloadComplete = true
                    currentDownload = nil
                }
            } catch {
                await MainActor.run {
                    isDownloading = false
                    errorMessage = error.localizedDescription
                    currentDownload = nil
                }
            }
        }
    }

    func cancelDownload() {
        isDownloading = false
        currentDownload = nil
    }

    func deleteModel(_ model: LocalModel) {
        let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
            .appendingPathComponent("huggingface/models/\(model.huggingFaceId.replacingOccurrences(of: "/", with: "--"))")
        try? FileManager.default.removeItem(at: cacheDir)
    }
}

// MARK: - On-Device LLM (MLX)

@MainActor
class OnDeviceLLM: ObservableObject {
    @Published var isLoaded = false
    @Published var isGenerating = false
    @Published var currentModelName = "Not loaded"
    @Published var useLocalModel = false
    @Published var localServerURL: String = ""
    @Published var localServerConnected = false

    let downloadManager = ModelDownloadManager.shared
    private var modelContainer: ModelContainer?
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

    // Load a model into memory for inference
    func loadModel(_ model: LocalModel) async -> Bool {
        isLoaded = false
        currentModelName = "Loading \(model.name)..."

        do {
            let config = ModelConfiguration(id: model.huggingFaceId)
            modelContainer = try await LLMModelFactory.shared.loadContainer(configuration: config) { progress in
                Task { @MainActor in
                    self.currentModelName = "Loading... \(Int(progress.fractionCompleted * 100))%"
                }
            }
            isLoaded = true
            currentModelName = "\(model.name) (On-Device)"
            return true
        } catch {
            currentModelName = "Load failed: \(error.localizedDescription)"
            return false
        }
    }

    func unloadModel() {
        modelContainer = nil
        isLoaded = false
        currentModelName = "Not loaded"
    }

    // Generate text using the loaded on-device model
    func generate(prompt: String, maxTokens: Int = 200) async -> String? {
        // Try on-device MLX model first
        if isLoaded, let container = modelContainer {
            return await generateOnDevice(prompt: prompt, container: container, maxTokens: maxTokens)
        }
        // Fallback to Gemini API
        return await generateViaAPI(prompt: prompt, maxTokens: maxTokens)
    }

    private func generateOnDevice(prompt: String, container: ModelContainer, maxTokens: Int) async -> String? {
        isGenerating = true
        defer { isGenerating = false }

        do {
            let systemPrompt = "You are DARVIS, a dry-witted British AI assistant. Concise, witty. 1-3 sentences."
            let messages = [
                ["role": "system", "content": systemPrompt],
                ["role": "user", "content": prompt],
            ]

            let fullPrompt = messages.map { "\($0["role"]!): \($0["content"]!)" }.joined(separator: "\n") + "\nassistant:"

            let result = try await container.perform { (context: ModelContext) in
                let input = try await context.processor.prepare(input: .init(prompt: fullPrompt))
                return try MLXLMCommon.generate(input: input, parameters: .init(temperature: 0.7, topP: 0.9), context: context) { tokens in
                    tokens.count < maxTokens ? .more : .stop
                }
            }
            return result.summary()
        } catch {
            return nil
        }
    }

    private func generateViaAPI(prompt: String, maxTokens: Int = 200) async -> String? {
        if apiKey == nil { await fetchKey() }
        guard let key = apiKey else { return nil }
        let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=\(key)")!

        let body: [String: Any] = [
            "contents": [["parts": [["text": prompt]]]],
            "systemInstruction": ["parts": [["text": "You are D.A.R.V.I.S., a Digital Assistant. Dry-witted, British. Running on Gemma 4 mode. Concise. 1-3 sentences."]]],
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
