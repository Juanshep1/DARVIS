import Foundation

/// Centralized API key storage. All keys live in UserDefaults so the iOS
/// app can talk to providers directly without hitting Netlify.
///
/// Keys are entered by the user in the Settings screen. Nothing is bundled
/// in the app binary, so this repo stays safe as public source.
enum APIKey: String, CaseIterable {
    case ollama = "apiKey.ollama"
    case gemini = "apiKey.gemini"
    case openrouter = "apiKey.openrouter"
    case elevenlabs = "apiKey.elevenlabs"
    case tavily = "apiKey.tavily"

    var displayName: String {
        switch self {
        case .ollama: return "Ollama Cloud"
        case .gemini: return "Gemini (Google AI)"
        case .openrouter: return "OpenRouter"
        case .elevenlabs: return "ElevenLabs"
        case .tavily: return "Tavily (web search)"
        }
    }

    var hint: String {
        switch self {
        case .ollama: return "ollama.com/settings/keys"
        case .gemini: return "aistudio.google.com/apikey"
        case .openrouter: return "openrouter.ai/keys"
        case .elevenlabs: return "elevenlabs.io/app/settings/api-keys"
        case .tavily: return "tavily.com/account/api-keys"
        }
    }

    /// Whether this key is strictly required for the core classic chat path.
    var isCore: Bool {
        switch self {
        case .ollama, .tavily: return true
        default: return false
        }
    }
}

enum APIKeys {
    /// Seed UserDefaults from a bundled Secrets.plist on first launch so
    /// the app works out of the box without manually pasting keys in
    /// Settings. The plist is git-ignored and only present on the
    /// developer's machine — CI / fresh clones get an empty bundle and
    /// fall back to the Settings screen flow.
    private static var didSeedBundledKeys = false
    static func seedFromBundleIfNeeded() {
        if didSeedBundledKeys { return }
        didSeedBundledKeys = true
        guard let url = Bundle.main.url(forResource: "Secrets", withExtension: "plist"),
              let data = try? Data(contentsOf: url),
              let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: String]
        else { return }
        for key in APIKey.allCases {
            let shortName = key.rawValue.replacingOccurrences(of: "apiKey.", with: "").uppercased() + "_API_KEY"
            let altName = key.rawValue.replacingOccurrences(of: "apiKey.", with: "").uppercased()
            let already = UserDefaults.standard.string(forKey: key.rawValue)
            if already == nil || already?.isEmpty == true {
                if let v = plist[shortName] ?? plist[altName], !v.isEmpty {
                    UserDefaults.standard.set(v, forKey: key.rawValue)
                }
            }
        }
    }

    static func get(_ key: APIKey) -> String? {
        seedFromBundleIfNeeded()
        let v = UserDefaults.standard.string(forKey: key.rawValue)
        guard let v, !v.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        return v
    }

    static func set(_ key: APIKey, _ value: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            UserDefaults.standard.removeObject(forKey: key.rawValue)
        } else {
            UserDefaults.standard.set(trimmed, forKey: key.rawValue)
        }
    }

    static func has(_ key: APIKey) -> Bool {
        return get(key) != nil
    }

    /// Convenience — default Ollama model used when the user hasn't picked one.
    static var defaultOllamaModel: String {
        return UserDefaults.standard.string(forKey: "ollama.defaultModel") ?? "gpt-oss:120b-cloud"
    }

    static func setDefaultOllamaModel(_ m: String) {
        UserDefaults.standard.set(m, forKey: "ollama.defaultModel")
    }
}
