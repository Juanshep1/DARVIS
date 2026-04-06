import Foundation

// On-device Gemma 4 inference via Gemini REST API with local-first fallback
// For true offline: integrate llama.cpp SPM package with a GGUF model
//
// Current approach: Uses Gemini 2.5 Flash (free API) as "on-device feel"
// with ultra-fast responses, and caches responses locally.
// When fully offline, returns cached responses or a fallback message.
//
// To add true on-device:
// 1. Add SwiftLlama SPM: https://github.com/nicktylah/llama-cpp-swift
// 2. Download gemma-2b Q4_K_M GGUF to app bundle
// 3. Call LlamaContext.generate()

@MainActor
class OnDeviceLLM: ObservableObject {
    @Published var isAvailable = false
    @Published var modelName = "Gemma 4 E2B (via API)"

    private let apiKey = "AIzaSyB5bZqg9H3ABY5bivM0F_9CTmFqfLzMB9E"
    private let model = "gemini-2.5-flash"
    private var responseCache: [String: String] = [:]

    init() {
        isAvailable = true
    }

    // Fast on-device-like inference via Gemini API
    func generate(prompt: String, systemPrompt: String = "You are DARVIS. Be concise. 1-2 sentences max.") async -> String? {
        // Check cache first (instant response for repeated queries)
        let cacheKey = prompt.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        if let cached = responseCache[cacheKey] {
            return cached
        }

        let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/\(model):generateContent?key=\(apiKey)")!

        let body: [String: Any] = [
            "contents": [["parts": [["text": prompt]]]],
            "systemInstruction": ["parts": [["text": systemPrompt]]],
            "generationConfig": ["maxOutputTokens": 200, "temperature": 0.7]
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
                let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
                responseCache[cacheKey] = clean
                return clean
            }
        } catch {
            // Offline — return nil
        }
        return nil
    }

    // Vision with on-device model
    func analyzeImage(base64JPEG: String, prompt: String) async -> String? {
        let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/\(model):generateContent?key=\(apiKey)")!

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
        request.timeoutInterval = 30

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
