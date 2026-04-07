import Foundation

struct ChatResponse: Codable {
    let reply: String
    let actions: [ChatAction]?
}

struct ChatAction: Codable {
    let action: String
    let url: String?
    let goal: String?
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

    private func request(_ path: String, method: String = "GET", body: Data? = nil) async throws -> Data {
        var req = URLRequest(url: URL(string: "\(baseURL)\(path)")!)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        req.timeoutInterval = 60
        let (data, _) = try await URLSession.shared.data(for: req)
        return data
    }

    // MARK: - Chat
    func sendChat(message: String) async throws -> ChatResponse {
        let body = try JSONEncoder().encode(["message": message])
        let data = try await request("/api/chat", method: "POST", body: body)
        return try JSONDecoder().decode(ChatResponse.self, from: data)
    }

    // MARK: - TTS
    func fetchTTS(text: String) async throws -> Data {
        let body = try JSONEncoder().encode(["text": text])
        return try await request("/api/tts", method: "POST", body: body)
    }

    // MARK: - Vision
    func sendVision(imageBase64: String, prompt: String? = nil) async throws -> String {
        var dict: [String: String] = ["image": imageBase64]
        if let p = prompt { dict["prompt"] = p }
        let body = try JSONSerialization.data(withJSONObject: dict)
        let data = try await request("/api/vision", method: "POST", body: body)
        let resp = try JSONDecoder().decode(VisionResponse.self, from: data)
        return resp.description
    }

    // MARK: - Memory
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

    // MARK: - History
    func getHistory() async throws -> [ChatMessage] {
        let data = try await request("/api/history")
        return try JSONDecoder().decode(HistoryResponse.self, from: data).messages
    }

    func appendHistory(messages: [ChatMessage]) async throws {
        let body = try JSONEncoder().encode(["messages": messages])
        _ = try await request("/api/history", method: "POST", body: body)
    }

    // MARK: - Settings
    func getSettings() async throws -> AppSettings {
        let data = try await request("/api/settings")
        return try JSONDecoder().decode(AppSettings.self, from: data)
    }

    func updateSettings(_ settings: AppSettings) async throws {
        let body = try JSONEncoder().encode(settings)
        _ = try await request("/api/settings", method: "POST", body: body)
    }

    // MARK: - Models & Voices
    func getModels() async throws -> ModelsResponse {
        let data = try await request("/api/models")
        return try JSONDecoder().decode(ModelsResponse.self, from: data)
    }

    func getVoices() async throws -> VoicesResponse {
        let data = try await request("/api/voices")
        return try JSONDecoder().decode(VoicesResponse.self, from: data)
    }

    // MARK: - Gemini Token
    func getGeminiToken() async throws -> GeminiTokenResponse {
        let data = try await request("/api/gemini-token")
        return try JSONDecoder().decode(GeminiTokenResponse.self, from: data)
    }

    // MARK: - Briefing
    func getBriefing() async throws -> String {
        let data = try await request("/api/briefing")
        struct BriefingResponse: Codable { let briefing: String }
        let resp = try JSONDecoder().decode(BriefingResponse.self, from: data)
        return resp.briefing
    }

    // MARK: - Agent
    func getAgentStatus() async throws -> AgentStatus {
        let data = try await request("/api/agent/status")
        return try JSONDecoder().decode(AgentStatus.self, from: data)
    }

    func getAgentScreenshot() async throws -> Data {
        return try await request("/api/agent/screenshot")
    }
}
