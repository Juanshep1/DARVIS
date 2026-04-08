import Foundation
import MLXLLM
import MLXLMCommon
import MLXHuggingFace

// Models available for on-device download
struct LocalModel: Identifiable {
    let id: String
    let name: String
    let size: String
    let huggingFaceId: String
    let params: String
}

let AVAILABLE_MODELS: [LocalModel] = [
    LocalModel(id: "gemma4-e4b-4bit", name: "Gemma 4 E4B (4-bit)", size: "~2.5 GB", huggingFaceId: "mlx-community/gemma-4-e4b-it-4bit", params: "4B"),
    LocalModel(id: "gemma4-e4b-8bit", name: "Gemma 4 E4B (8-bit, Best)", size: "~5 GB", huggingFaceId: "mlx-community/gemma-4-e4b-it-8bit", params: "4B"),
    LocalModel(id: "gemma4-e2b", name: "Gemma 4 E2B (2B - Fastest)", size: "~1.5 GB", huggingFaceId: "unsloth/gemma-4-E2B-it-UD-MLX-4bit", params: "2B"),
]

// MARK: - On-Device LLM via Apple MLX

@MainActor
class OnDeviceLLM: ObservableObject {
    @Published var isLoaded = false
    @Published var isGenerating = false
    @Published var isDownloading = false
    @Published var downloadProgress: Double = 0
    @Published var currentModelName = "Not loaded"
    @Published var statusMessage = ""

    private var modelContainer: ModelContainer?
    private var apiKey: String?

    let downloadManager = ModelDownloadManager.shared

    init() {
        Task { await fetchKey() }
    }

    private func fetchKey() async {
        do {
            let token = try await APIClient.shared.getGeminiToken()
            apiKey = token.token
        } catch {}
    }

    // MARK: - Download + Load Model

    func downloadAndLoad(_ model: LocalModel) {
        guard !isDownloading else { return }
        isDownloading = true
        downloadProgress = 0
        statusMessage = "Downloading \(model.name)..."

        Task {
            do {
                let config = ModelConfiguration(id: model.huggingFaceId)
                let container = try await #huggingFaceLoadModelContainer(
                    configuration: config,
                    progressHandler: { progress in
                        Task { @MainActor in
                            self.downloadProgress = progress.fractionCompleted
                            self.statusMessage = "Downloading... \(Int(progress.fractionCompleted * 100))%"
                        }
                    }
                )
                modelContainer = container
                isLoaded = true
                currentModelName = "\(model.name) (On-Device)"
                statusMessage = "Ready — running locally"
                isDownloading = false
            } catch {
                statusMessage = "Error: \(error.localizedDescription)"
                isDownloading = false
            }
        }
    }

    func unloadModel() {
        modelContainer = nil
        isLoaded = false
        currentModelName = "Not loaded"
        statusMessage = ""
    }

    // MARK: - Generate

    func generate(prompt: String, maxTokens: Int = 200) async -> String? {
        // Try on-device first
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
            let messages: [Chat.Message] = [
                .init(role: .system, content: "You are DARVIS, a dry-witted British AI assistant. Running on-device via MLX on iPhone. Concise. 1-3 sentences."),
                .init(role: .user, content: prompt),
            ]

            let userInput = UserInput(prompt: .chat(messages))
            let lmInput = try await container.prepare(input: userInput)
            let params = GenerateParameters(temperature: 0.7)

            var output = ""
            let stream = try await container.generate(input: lmInput, parameters: params)
            for await generation in stream {
                if let chunk = generation.chunk {
                    output += chunk
                }
                if output.count > maxTokens * 4 { break }
            }
            return output.trimmingCharacters(in: .whitespacesAndNewlines)
        } catch {
            statusMessage = "Inference error: \(error.localizedDescription)"
            return nil
        }
    }

    private func generateViaAPI(prompt: String, maxTokens: Int = 200) async -> String? {
        if apiKey == nil { await fetchKey() }
        guard let key = apiKey else { return nil }
        let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=\(key)")!

        let body: [String: Any] = [
            "contents": [["parts": [["text": prompt]]]],
            "systemInstruction": ["parts": [["text": "You are D.A.R.V.I.S. Dry-witted British AI. Running on Gemma 4 mode (cloud fallback). Concise. 1-3 sentences."]]],
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

// MARK: - Minimal Download Manager (MLX handles caching)

class ModelDownloadManager: NSObject, ObservableObject {
    static let shared = ModelDownloadManager()
    func setup() {}
}
