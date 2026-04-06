import Foundation

struct AppSettings: Codable {
    var model: String
    var voice_id: String
    var audio_mode: String // "classic" or "gemini"
}

struct ModelsResponse: Codable {
    let models: [String]
    let current: String
}

struct VoiceOption: Identifiable, Codable {
    let id: String
    let name: String
    let category: String
}

struct VoicesResponse: Codable {
    let voices: [VoiceOption]
    let current: String
}
