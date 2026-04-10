import Foundation

struct LocalModel: Identifiable {
    let id: String
    let name: String
    let size: String
    let params: String
}

let AVAILABLE_MODELS: [LocalModel] = [
    LocalModel(id: "gemma4-e4b", name: "Gemma 4 E4B (4B)", size: "~2.5 GB", params: "4B"),
    LocalModel(id: "gemma4-e2b", name: "Gemma 4 E2B (2B)", size: "~1.5 GB", params: "2B"),
]

@MainActor
class OnDeviceLLM: ObservableObject {
    @Published var isLoaded = false
    @Published var currentModelName = "Gemini 2.5 Flash (Cloud)"
    @Published var statusMessage = ""

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

    func generate(prompt: String, maxTokens: Int = 200) async -> String? {
        if apiKey == nil { await fetchKey() }
        guard let key = apiKey else { return nil }
        let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=\(key)")!

        let body: [String: Any] = [
            "contents": [["parts": [["text": prompt]]]],
            "systemInstruction": ["parts": [["text": "You are S.P.E.C.T.R.A. Dry-witted British AI. Running Gemma 4 mode on iOS. Concise. 1-3 sentences."]]],
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

class ModelDownloadManager: NSObject, ObservableObject {
    static let shared = ModelDownloadManager()
    func setup() {}
}
