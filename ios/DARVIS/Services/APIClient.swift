import Foundation

struct ChatResponse: Codable {
    let reply: String
    let actions: [ChatAction]?
}

struct ChatAction: Codable {
    let action: String
    let url: String?
    let goal: String?
    let task: String?
    let at: String?
    let message: String?
}

struct VisionResponse: Codable {
    let description: String
}

struct GeminiTokenResponse: Codable {
    let token: String
    let model: String
    let useAsKey: Bool?
}

struct HistoryResponse: Codable {
    let messages: [ChatMessage]
}

class APIClient {
    static let shared = APIClient()
    private let baseURL = "https://darvis1.netlify.app"
    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 90
        config.timeoutIntervalForResource = 120
        config.waitsForConnectivity = false
        session = URLSession(configuration: config)
    }

    private func request(_ path: String, method: String = "GET", body: Data? = nil, retries: Int = 1) async throws -> Data {
        guard let url = URL(string: "\(baseURL)\(path)") else {
            throw URLError(.badURL)
        }
        var lastError: Error?
        for attempt in 0...retries {
            do {
                var req = URLRequest(url: url)
                req.httpMethod = method
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.httpBody = body
                let (data, response) = try await session.data(for: req)
                if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
                    throw URLError(.badServerResponse)
                }
                return data
            } catch {
                lastError = error
                if attempt < retries {
                    try? await Task.sleep(nanoseconds: 2_000_000_000) // 2s before retry
                }
            }
        }
        throw lastError ?? URLError(.unknown)
    }

    func sendChat(message: String) async throws -> ChatResponse {
        let body = try JSONEncoder().encode(["message": message])
        let data = try await request("/api/chat", method: "POST", body: body, retries: 2)
        return try JSONDecoder().decode(ChatResponse.self, from: data)
    }

    func fetchTTS(text: String) async throws -> Data {
        let body = try JSONEncoder().encode(["text": text])
        return try await request("/api/tts", method: "POST", body: body)
    }

    func sendVision(imageBase64: String, prompt: String? = nil) async throws -> String {
        var dict: [String: String] = ["image": imageBase64]
        if let p = prompt { dict["prompt"] = p }
        let body = try JSONSerialization.data(withJSONObject: dict)
        let data = try await request("/api/vision", method: "POST", body: body)
        let resp = try JSONDecoder().decode(VisionResponse.self, from: data)
        return resp.description
    }

    func getMemories() async throws -> [Memory] {
        let data = try await request("/api/memory")
        return try JSONDecoder().decode(MemoryResponse.self, from: data).memories
    }

    func addMemory(content: String, category: String = "general") async throws {
        let dict: [String: String] = ["content": content, "category": category]
        let body = try JSONSerialization.data(withJSONObject: dict)
        _ = try await request("/api/memory", method: "POST", body: body)
    }

    func deleteMemory(id: Int) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["id": id])
        _ = try await request("/api/memory", method: "DELETE", body: body)
    }

    func getHistory() async throws -> [ChatMessage] {
        let data = try await request("/api/history")
        return try JSONDecoder().decode(HistoryResponse.self, from: data).messages
    }

    func appendHistory(messages: [ChatMessage]) async throws {
        let body = try JSONEncoder().encode(["messages": messages])
        _ = try await request("/api/history", method: "POST", body: body)
    }

    func getSettings() async throws -> AppSettings {
        let data = try await request("/api/settings")
        return try JSONDecoder().decode(AppSettings.self, from: data)
    }

    func updateSettings(_ settings: AppSettings) async throws {
        let body = try JSONEncoder().encode(settings)
        _ = try await request("/api/settings", method: "POST", body: body)
    }

    func getModels() async throws -> ModelsResponse {
        let data = try await request("/api/models")
        return try JSONDecoder().decode(ModelsResponse.self, from: data)
    }

    func getVoices() async throws -> VoicesResponse {
        let data = try await request("/api/voices")
        return try JSONDecoder().decode(VoicesResponse.self, from: data)
    }

    func getGeminiToken() async throws -> GeminiTokenResponse {
        let data = try await request("/api/gemini-token")
        return try JSONDecoder().decode(GeminiTokenResponse.self, from: data)
    }

    func getAgentStatus() async throws -> AgentStatus {
        let data = try await request("/api/agent/status")
        return try JSONDecoder().decode(AgentStatus.self, from: data)
    }

    func getAgentScreenshot() async throws -> Data {
        return try await request("/api/agent/screenshot")
    }

    func getBriefing() async throws -> String {
        let data = try await request("/api/briefing")
        struct R: Codable { let briefing: String }
        return try JSONDecoder().decode(R.self, from: data).briefing
    }
}
