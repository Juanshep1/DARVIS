import Foundation

// ── Data models used across the iOS app ────────────────────────────────

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

/// Facade that used to call Netlify Functions. Everything now runs locally:
/// - Chat → BrainService (Ollama direct + Tavily + local memory/history)
/// - TTS  → DirectAPI (ElevenLabs / StreamElements direct; Apple Voice local)
/// - Memory/History/Settings → LocalStore (JSON in Documents)
/// - Gemini token → local Gemini key (no ephemeral exchange needed)
/// - Vision → OnDeviceLLM.analyzeImage (Gemini 2.5 Flash direct)
///
/// Cross-device sync is dropped — this is an iOS-only store now. Can be
/// wired to Cloudflare Workers later when we finish the backend migration.
@MainActor
class APIClient {
    static let shared = APIClient()
    private init() {}

    // MARK: - Chat

    func sendChat(message: String) async throws -> ChatResponse {
        let reply = try await BrainService.shared.classicChat(message: message)
        // Save to local history (user + assistant)
        LocalStore.appendHistory([
            ChatMessage(role: "user", content: message),
            ChatMessage(role: "assistant", content: reply)
        ])
        return ChatResponse(reply: reply, actions: nil)
    }

    // MARK: - TTS — routes by provider, all direct or native

    func fetchTTS(text: String) async throws -> Data {
        let provider = UserDefaults.standard.string(forKey: "ttsProvider") ?? "browser"
        switch provider {
        case "elevenlabs":
            // Canonical voice id lives in AppSettings (same place the
            // Settings screen writes via setVoice). Fall back to the
            // legacy "elevenLabsVoiceId" key, then to a sensible default.
            let settingsVoice = LocalStore.loadSettings().voice_id
            let voiceId = !settingsVoice.isEmpty
                ? settingsVoice
                : (UserDefaults.standard.string(forKey: "elevenLabsVoiceId")
                    ?? "21m00Tcm4TlvDq8ikWAM")
            return try await DirectAPI.elevenLabsTTS(text: text, voiceId: voiceId)
        case "streamelements":
            let voice = UserDefaults.standard.string(forKey: "streamElementsVoice") ?? "Brian"
            return try await DirectAPI.streamElementsTTS(text: text, voice: voice)
        default:
            // "browser" / unknown → fall back to iOS native speech
            throw URLError(.cancelled)
        }
    }

    // MARK: - Vision

    func sendVision(imageBase64: String, prompt: String? = nil) async throws -> String {
        let llm = OnDeviceLLM()
        let p = prompt ?? "Describe what you see in the image. Be concise and direct."
        guard let result = await llm.analyzeImage(base64JPEG: imageBase64, prompt: p) else {
            throw URLError(.badServerResponse)
        }
        return result
    }

    // MARK: - Memory (local)

    func getMemories() async throws -> [Memory] {
        return LocalStore.loadMemories()
    }

    func addMemory(content: String, category: String = "general") async throws {
        _ = LocalStore.addMemory(content: content, category: category)
    }

    func deleteMemory(id: Int) async throws {
        LocalStore.deleteMemory(id: id)
    }

    // MARK: - History (local)

    func getHistory() async throws -> [ChatMessage] {
        return LocalStore.loadHistory()
    }

    func appendHistory(messages: [ChatMessage]) async throws {
        LocalStore.appendHistory(messages)
    }

    // MARK: - Settings (local)

    func getSettings() async throws -> AppSettings {
        return LocalStore.loadSettings()
    }

    func updateSettings(_ settings: AppSettings) async throws {
        LocalStore.saveSettings(settings)
    }

    // MARK: - Models / Voices (from provider direct)

    func getModels() async throws -> ModelsResponse {
        do {
            let models = try await DirectAPI.ollamaModels()
            let current = LocalStore.loadSettings().model
            return ModelsResponse(models: models, current: current.isEmpty ? APIKeys.defaultOllamaModel : current)
        } catch {
            // Fallback to a curated list if we can't reach Ollama Cloud
            let fallback = [
                "gpt-oss:120b-cloud",
                "gpt-oss:20b-cloud",
                "qwen3-coder:480b-cloud",
                "deepseek-v3.1:671b-cloud",
                "glm-4.6:cloud",
            ]
            return ModelsResponse(models: fallback, current: APIKeys.defaultOllamaModel)
        }
    }

    func getVoices() async throws -> VoicesResponse {
        do {
            let voices = try await DirectAPI.elevenLabsVoices()
            let current = UserDefaults.standard.string(forKey: "elevenLabsVoiceId") ?? ""
            return VoicesResponse(
                voices: voices.map { VoiceOption(id: $0.id, name: $0.name, category: $0.category) },
                current: current
            )
        } catch {
            return VoicesResponse(voices: [], current: "")
        }
    }

    // MARK: - Gemini token (local key — no server exchange)

    func getGeminiToken() async throws -> GeminiTokenResponse {
        guard let key = APIKeys.get(.gemini) else {
            throw DirectAPI.DirectError.missingKey(.gemini)
        }
        return GeminiTokenResponse(
            token: key,
            model: "gemini-2.5-flash-native-audio-latest",
            useAsKey: true
        )
    }

    // MARK: - Agent (disabled on iOS — needs terminal daemon)

    func getAgentStatus() async throws -> AgentStatus {
        // Browser-agent status requires a terminal daemon. On iOS-only
        // deployments this is inert.
        return AgentStatus(active: false, goal: "", step: 0, thinking: "Agent requires desktop terminal.", done: true)
    }

    func getAgentScreenshot() async throws -> Data {
        throw URLError(.unsupportedURL)
    }

    // MARK: - Briefing (built on-device from Ollama + Tavily)

    func getBriefing() async throws -> String {
        // Compose a brief news summary using Tavily + Ollama on-device.
        let query = "top US and world news headlines today"
        var sources = ""
        if let sr = try? await DirectAPI.tavilySearch(query: query, maxResults: 10) {
            sources = sr.render()
        }
        let prompt = """
        Give a spoken morning briefing for the user, sir. 5 top stories with one substantive sentence each. British tone, subtle wit, no throat-clearing.

        \(BrainService.currentTimeBlock())

        News sources:
        \(sources)
        """
        let model = LocalStore.loadSettings().model.isEmpty ? APIKeys.defaultOllamaModel : LocalStore.loadSettings().model
        return try await DirectAPI.ollamaChat(
            model: model,
            messages: [.init(role: "user", content: prompt)]
        )
    }
}

