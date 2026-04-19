import Foundation

/// Direct HTTP calls to provider APIs — no Netlify proxy. Every method
/// pulls its API key from APIKeys and talks to the vendor directly.
enum DirectAPI {

    enum DirectError: LocalizedError {
        case missingKey(APIKey)
        case badStatus(Int, String)
        case badResponse(String)

        var errorDescription: String? {
            switch self {
            case .missingKey(let k): return "Missing \(k.displayName) API key. Add it in Settings."
            case .badStatus(let code, let body): return "HTTP \(code): \(body.prefix(200))"
            case .badResponse(let msg): return msg
            }
        }
    }

    private static let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 90
        c.timeoutIntervalForResource = 120
        c.waitsForConnectivity = false
        return URLSession(configuration: c)
    }()

    // MARK: - Ollama Cloud (classic mode brain)

    struct OllamaMessage: Codable {
        let role: String
        let content: String
    }

    static func ollamaChat(model: String, messages: [OllamaMessage], timeout: TimeInterval = 110) async throws -> String {
        guard let key = APIKeys.get(.ollama) else { throw DirectError.missingKey(.ollama) }
        let url = URL(string: "https://ollama.com/api/chat")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        req.timeoutInterval = timeout
        let body: [String: Any] = [
            "model": model,
            "messages": messages.map { ["role": $0.role, "content": $0.content] },
            "stream": false
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw DirectError.badResponse("no response") }
        if http.statusCode >= 400 {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw DirectError.badStatus(http.statusCode, body)
        }
        if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
           let msg = json["message"] as? [String: Any],
           let text = msg["content"] as? String {
            return text
        }
        throw DirectError.badResponse("ollama: couldn't parse reply")
    }

    static func ollamaModels() async throws -> [String] {
        // Ollama Cloud model catalog — returns what the user's key can run
        guard let key = APIKeys.get(.ollama) else { throw DirectError.missingKey(.ollama) }
        let url = URL(string: "https://ollama.com/api/tags")!
        var req = URLRequest(url: url)
        req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await session.data(for: req)
        if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
           let models = json["models"] as? [[String: Any]] {
            return models.compactMap { $0["name"] as? String ?? $0["model"] as? String }
        }
        return []
    }

    // MARK: - OpenRouter

    static func openRouterChat(model: String, messages: [OllamaMessage]) async throws -> (reply: String, model: String) {
        guard let key = APIKeys.get(.openrouter) else { throw DirectError.missingKey(.openrouter) }
        let url = URL(string: "https://openrouter.ai/api/v1/chat/completions")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        req.setValue("https://github.com/Juanshep1/DARVIS", forHTTPHeaderField: "HTTP-Referer")
        req.setValue("Spectra iOS", forHTTPHeaderField: "X-Title")
        let body: [String: Any] = [
            "model": model,
            "messages": messages.map { ["role": $0.role, "content": $0.content] }
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw DirectError.badResponse("no response") }
        if http.statusCode >= 400 {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw DirectError.badStatus(http.statusCode, body)
        }
        if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
           let choices = json["choices"] as? [[String: Any]],
           let msg = choices.first?["message"] as? [String: Any],
           let text = msg["content"] as? String {
            let actualModel = (json["model"] as? String) ?? model
            return (text, actualModel)
        }
        throw DirectError.badResponse("openrouter: couldn't parse reply")
    }

    // MARK: - Tavily web search

    struct TavilyResult {
        let answer: String?
        let sources: [(title: String, url: String, content: String)]

        func render() -> String {
            var out = ""
            if let a = answer, !a.isEmpty { out += "Answer: \(a)\n\n" }
            if !sources.isEmpty {
                out += "Sources:\n"
                for (i, s) in sources.enumerated() {
                    out += "\(i+1). \(s.title)\n   \(s.url)\n   \(s.content.prefix(500))\n\n"
                }
            }
            return out
        }
    }

    static func tavilySearch(query: String, maxResults: Int = 8) async throws -> TavilyResult {
        guard let key = APIKeys.get(.tavily) else { throw DirectError.missingKey(.tavily) }
        let url = URL(string: "https://api.tavily.com/search")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 15
        let body: [String: Any] = [
            "api_key": key,
            "query": query,
            "search_depth": "advanced",
            "max_results": maxResults,
            "include_answer": true
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, _) = try await session.data(for: req)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw DirectError.badResponse("tavily: not JSON")
        }
        let answer = json["answer"] as? String
        var sources: [(String, String, String)] = []
        if let results = json["results"] as? [[String: Any]] {
            for r in results {
                let t = r["title"] as? String ?? ""
                let u = r["url"] as? String ?? ""
                let c = r["content"] as? String ?? ""
                sources.append((t, u, c))
            }
        }
        return TavilyResult(answer: answer, sources: sources.map { (title: $0.0, url: $0.1, content: $0.2) })
    }

    // MARK: - Gemini 2.5 Flash (for query rewrite + fallback)

    static func geminiGenerate(prompt: String, maxTokens: Int = 200, useSearch: Bool = false) async throws -> String {
        guard let key = APIKeys.get(.gemini) else { throw DirectError.missingKey(.gemini) }
        let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=\(key)")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 30
        var body: [String: Any] = [
            "contents": [["parts": [["text": prompt]]]],
            "generationConfig": ["maxOutputTokens": maxTokens, "temperature": 0.2]
        ]
        if useSearch {
            body["tools"] = [["googleSearch": [:]]]
        }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw DirectError.badResponse("no response") }
        if http.statusCode >= 400 {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw DirectError.badStatus(http.statusCode, body)
        }
        if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
           let candidates = json["candidates"] as? [[String: Any]],
           let content = candidates.first?["content"] as? [String: Any],
           let parts = content["parts"] as? [[String: Any]] {
            let text = parts.compactMap { $0["text"] as? String }.joined(separator: "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty { return text }
        }
        throw DirectError.badResponse("gemini: empty response")
    }

    // MARK: - ElevenLabs TTS

    static func elevenLabsTTS(text: String, voiceId: String, modelId: String = "eleven_turbo_v2_5") async throws -> Data {
        guard let key = APIKeys.get(.elevenlabs) else { throw DirectError.missingKey(.elevenlabs) }
        let id = voiceId.isEmpty ? "21m00Tcm4TlvDq8ikWAM" : voiceId // Rachel default
        let url = URL(string: "https://api.elevenlabs.io/v1/text-to-speech/\(id)")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("audio/mpeg", forHTTPHeaderField: "Accept")
        req.setValue(key, forHTTPHeaderField: "xi-api-key")
        req.timeoutInterval = 30
        let body: [String: Any] = [
            "text": text,
            "model_id": modelId,
            "voice_settings": ["stability": 0.5, "similarity_boost": 0.75]
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw DirectError.badResponse("no response") }
        if http.statusCode >= 400 {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw DirectError.badStatus(http.statusCode, body)
        }
        return data
    }

    static func elevenLabsVoices() async throws -> [(id: String, name: String, category: String)] {
        guard let key = APIKeys.get(.elevenlabs) else { throw DirectError.missingKey(.elevenlabs) }
        var req = URLRequest(url: URL(string: "https://api.elevenlabs.io/v1/voices")!)
        req.setValue(key, forHTTPHeaderField: "xi-api-key")
        let (data, _) = try await session.data(for: req)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let voices = json["voices"] as? [[String: Any]] else { return [] }
        return voices.compactMap { v in
            guard let id = v["voice_id"] as? String,
                  let name = v["name"] as? String else { return nil }
            let cat = v["category"] as? String ?? "default"
            return (id, name, cat)
        }
    }

    // MARK: - StreamElements TTS (free, no key)

    static func streamElementsTTS(text: String, voice: String = "Brian") async throws -> Data {
        var comps = URLComponents(string: "https://api.streamelements.com/kappa/v2/speech")!
        comps.queryItems = [
            URLQueryItem(name: "voice", value: voice),
            URLQueryItem(name: "text", value: text)
        ]
        let (data, response) = try await session.data(from: comps.url!)
        if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw DirectError.badStatus(http.statusCode, body)
        }
        return data
    }

    // MARK: - Weather (Open-Meteo — free, no key needed)

    struct WeatherReport {
        let location: String
        let summary: String
    }

    static func weather(for city: String) async throws -> WeatherReport {
        // Geocode first
        let geoURL = URL(string: "https://geocoding-api.open-meteo.com/v1/search?name=\(city.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? city)&count=1&language=en&format=json")!
        let (geoData, _) = try await session.data(from: geoURL)
        guard let geo = try JSONSerialization.jsonObject(with: geoData) as? [String: Any],
              let results = geo["results"] as? [[String: Any]],
              let first = results.first,
              let lat = first["latitude"] as? Double,
              let lon = first["longitude"] as? Double else {
            throw DirectError.badResponse("couldn't geocode '\(city)'")
        }
        let name = (first["name"] as? String) ?? city
        let region = (first["admin1"] as? String).flatMap { ", \($0)" } ?? ""

        let url = URL(string: "https://api.open-meteo.com/v1/forecast?latitude=\(lat)&longitude=\(lon)&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=5&timezone=auto")!
        let (data, _) = try await session.data(from: url)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw DirectError.badResponse("weather parse error")
        }

        var summary = ""
        if let cur = json["current"] as? [String: Any] {
            let t = cur["temperature_2m"] as? Double ?? 0
            let feels = cur["apparent_temperature"] as? Double ?? t
            let hum = cur["relative_humidity_2m"] as? Double ?? 0
            let wind = cur["wind_speed_10m"] as? Double ?? 0
            let gusts = cur["wind_gusts_10m"] as? Double ?? 0
            let code = cur["weather_code"] as? Int ?? 0
            summary += "Current: \(describeWeatherCode(code)) · \(Int(t.rounded()))°F (feels \(Int(feels.rounded()))°F) · Humidity \(Int(hum))% · Wind \(Int(wind)) mph (gusts \(Int(gusts)) mph)\n"
        }
        if let daily = json["daily"] as? [String: Any],
           let times = daily["time"] as? [String],
           let highs = daily["temperature_2m_max"] as? [Double],
           let lows = daily["temperature_2m_min"] as? [Double],
           let precip = daily["precipitation_probability_max"] as? [Double],
           let codes = daily["weather_code"] as? [Int] {
            summary += "Forecast:\n"
            for i in 0..<min(times.count, 5) {
                summary += "  \(times[i]): \(describeWeatherCode(codes[i])) · High \(Int(highs[i].rounded()))°F / Low \(Int(lows[i].rounded()))°F · \(Int(precip[i]))% precip\n"
            }
        }

        return WeatherReport(location: "\(name)\(region)", summary: summary)
    }

    private static func describeWeatherCode(_ code: Int) -> String {
        switch code {
        case 0: return "Clear sky"
        case 1, 2, 3: return "Partly cloudy"
        case 45, 48: return "Fog"
        case 51, 53, 55: return "Drizzle"
        case 61, 63, 65: return "Rain"
        case 66, 67: return "Freezing rain"
        case 71, 73, 75: return "Snow"
        case 77: return "Snow grains"
        case 80, 81, 82: return "Rain showers"
        case 85, 86: return "Snow showers"
        case 95: return "Thunderstorm"
        case 96, 99: return "Thunderstorm with hail"
        default: return "Unknown"
        }
    }
}
