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
    /// Bundled Secrets.plist parsed once and memoised. The plist is
    /// git-ignored and only present on the developer's machine — fresh
    /// clones get an empty bundle and fall back to the Settings screen.
    private static let bundled: [String: String] = {
        guard let url = Bundle.main.url(forResource: "Secrets", withExtension: "plist"),
              let data = try? Data(contentsOf: url),
              let any = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil),
              let dict = any as? [String: Any]
        else {
            NSLog("[APIKeys] No Secrets.plist bundled — keys must be entered in Settings")
            return [:]
        }
        var out: [String: String] = [:]
        for (k, v) in dict {
            if let s = v as? String, !s.isEmpty { out[k] = s }
        }
        NSLog("[APIKeys] Loaded \(out.count) keys from Secrets.plist")
        return out
    }()

    private static func bundledValue(for key: APIKey) -> String? {
        // Plist keys look like "OLLAMA_API_KEY". Map back from enum raw values.
        let short = key.rawValue.replacingOccurrences(of: "apiKey.", with: "").uppercased()
        return bundled["\(short)_API_KEY"] ?? bundled[short]
    }

    static func get(_ key: APIKey) -> String? {
        // User-set value (via Settings) wins; otherwise fall through to
        // the bundled plist. This makes the app self-seeding AND keeps
        // user overrides working.
        if let v = UserDefaults.standard.string(forKey: key.rawValue),
           !v.trimmingCharacters(in: .whitespaces).isEmpty {
            return v
        }
        return bundledValue(for: key)
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
