import Foundation

/// On-device replacement for the Netlify /api/chat endpoint.
/// Same flow: detect search need → rewrite pronouns via Gemini → Tavily →
/// build system prompt with time/memory/history/search → Ollama chat.
@MainActor
final class BrainService {
    static let shared = BrainService()
    private init() {}

    /// Single entrypoint that mirrors chat.mjs behavior for the classic mode.
    func classicChat(message: String) async throws -> String {
        let historyAll = LocalStore.loadHistory()
        let memories = LocalStore.loadMemories()
        let history = Array(historyAll.suffix(20))

        // 1. Decide if we need a web search.
        let shouldSearch = Self.needsSearch(message)

        // 2. Resolve pronouns in ambiguous follow-ups via Gemini rewrite.
        var searchQuery = message
        if shouldSearch, Self.isAmbiguousFollowup(message, historyLen: history.count) {
            if let rewritten = await Self.rewriteSearchQuery(message: message, history: history) {
                searchQuery = rewritten
            } else if !history.isEmpty {
                let ctx = history.suffix(4).map { $0.content }.joined(separator: " ")
                searchQuery = String("\(ctx) \(message)".prefix(400))
            }
        }

        // 3. Tavily search if needed.
        var searchContext = ""
        if shouldSearch {
            do {
                let result = try await DirectAPI.tavilySearch(query: searchQuery, maxResults: 8)
                let queryNote = searchQuery != message
                    ? "User asked: \"\(message)\"\nResolved query (pronouns expanded): \"\(searchQuery)\""
                    : "Search query: \"\(message)\""
                searchContext = "\n\nWEB SEARCH RESULTS\n\(queryNote)\n\n\(result.render())\nIMPORTANT: Use ONLY these search results for factual claims. Do NOT use training data for facts that could be outdated. Cite specific facts exactly as shown."
            } catch {
                // Search failed — proceed without it. The LLM will rely on training data.
            }
        }

        // 4. Weather pre-fetch if query mentions weather.
        var weatherContext = ""
        let lower = message.lowercased()
        let weatherTriggers = ["weather", "forecast", "temperature", "rain", "snow", "wind", "humidity", "outside", "cold", "hot", "warm", "storm", "sunny", "cloudy"]
        if weatherTriggers.contains(where: { lower.contains($0) }) {
            var city = Self.extractCity(from: message) ?? "Dallas"
            city = city.trimmingCharacters(in: .whitespacesAndNewlines)
            if let wr = try? await DirectAPI.weather(for: city) {
                weatherContext = "\n\nREAL-TIME WEATHER DATA (just fetched):\nLocation: \(wr.location)\n\(wr.summary)\nIMPORTANT: Use this data directly. Do NOT say you can't access weather."
            }
        }

        // 5. Memory context.
        var memoryContext = ""
        if !memories.isEmpty {
            memoryContext = "\n\nUser's saved memories:\n" + memories.map { "- [\($0.category)] \($0.content)" }.joined(separator: "\n")
        }

        // 6. Wiki context.
        var wikiContext = ""
        let pages = LocalStore.loadWikiPages()
        if !pages.isEmpty {
            let words = Set(message.lowercased().split(separator: " ").filter { $0.count > 2 }.map { String($0) })
            let scored = pages.map { p -> (LocalStore.WikiPage, Int) in
                let hay = "\(p.title) \(p.summary) \(p.tags.joined(separator: " "))".lowercased()
                let score = words.filter { hay.contains($0) }.count
                return (p, score)
            }.filter { $0.1 > 0 }.sorted { $0.1 > $1.1 }.prefix(3)
            if !scored.isEmpty {
                wikiContext = "\n\nRelevant wiki knowledge:\n" + scored.map { "### \($0.0.title)\n\($0.0.content.prefix(2000))" }.joined(separator: "\n\n")
            }
        }

        // 7. Time block — always device-local.
        let timeBlock = Self.currentTimeBlock()

        // 8. Compose system prompt and message list.
        let settings = LocalStore.loadSettings()
        let model = settings.model.isEmpty ? APIKeys.defaultOllamaModel : settings.model
        let historyCount = history.count

        let memoryCount = memories.count
        let systemPrompt = """
        You are the user's personal AI assistant. Be helpful, loyal, and concise. Respond with subtle wit and a British tone — but NEVER describe your own personality traits. No self-referential statements like "ever efficient". Just answer the question.
        NEVER say "Spectra" or any name for yourself. Do NOT introduce yourself. The ONLY exception: if the user directly asks "who are you?", say "Spectra".
        Address the user as "sir" (male). NEVER use "ma'am".

        CRITICAL MEMORY RULES:
        - You have \(memoryCount) saved memories about the user loaded at the bottom of this prompt. They are REAL facts the user has told you. USE them — when the user asks "what do you remember about me?" or "what did I tell you about X?", answer from those memories. NEVER say "I don't remember" or "I have no memory of that" when the answer IS in the memories below.
        - To save a new fact during this reply, emit a command block:
          ```command
          {"action": "remember", "content": "fact to remember", "category": "general"}
          ```
          Categories: general, preference, reminder, fact, person.
        - To delete a memory by id:
          ```command
          {"action": "forget", "id": 3}
          ```

        CRITICAL: You HAVE full conversation history loaded (\(historyCount) prior messages). USE IT. Never say "I don't have access to previous conversations" — the history is right here.

        \(timeBlock)

        You run on \(model) via Ollama Cloud on the iOS SPECTRA app — no backend server. When web search results are provided below, use ONLY those for factual claims. Be thorough but fast. Start with the answer, skip throat-clearing.\(memoryContext)\(wikiContext)\(searchContext)\(weatherContext)
        """

        var messages: [DirectAPI.OllamaMessage] = [.init(role: "system", content: systemPrompt)]
        for m in history {
            messages.append(.init(role: m.role, content: m.content))
        }
        messages.append(.init(role: "user", content: message))

        // 9. Call Ollama directly.
        let raw = try await DirectAPI.ollamaChat(model: model, messages: messages)
        let reply = Self.stripCommandBlocks(raw).trimmingCharacters(in: .whitespacesAndNewlines)

        // 10. Process any command blocks (remember/forget locally).
        Self.processCommandBlocks(raw)

        return reply.isEmpty ? "Done, sir." : reply
    }

    // MARK: - Search heuristics (mirror of chat.mjs needsSearch)

    static func needsSearch(_ msg: String) -> Bool {
        let lower = msg.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !lower.isEmpty else { return false }

        let chatter: [String] = [
            "^(hi|hey|hello|yo|sup|good (morning|afternoon|evening|night))\\b",
            "^(thanks|thank you|thx|cheers|nice|cool|awesome|great|ok|okay|k)\\b",
            "^(are you there|you there|you awake|can you hear me)\\b",
            "^(what can you do|what are you|who are you)\\b",
            "^(shut up|stop|pause|be quiet|nevermind|never mind|cancel)\\b",
            "^(yes|yeah|yep|yup|no|nope|nah|sure|fine|maybe)[\\s.!?]*$"
        ]
        if chatter.contains(where: { lower.range(of: $0, options: .regularExpression) != nil }) { return false }

        let nonSearch: [String] = [
            "^(open|launch|start|close|quit|kill)\\s",
            "^(create|write|make|save|generate)\\s.*(file|folder|document|note|text|script)",
            "^(play|pause|skip|resume|next|previous|stop)\\b",
            "^(remember|forget|remind me|set a reminder|set a timer)\\b",
            "^(schedule|set an alert)\\b",
            "^(run |execute |shell )"
        ]
        if nonSearch.contains(where: { lower.range(of: $0, options: .regularExpression) != nil }) { return false }

        if lower.range(of: "^(who|what|when|where|why|how|which|whose|whom)\\b", options: .regularExpression) != nil { return true }
        if lower.range(of: "^(is |are |was |were |do |does |did |has |have |had |can |could |will |would |should |may |might )", options: .regularExpression) != nil { return true }
        if lower.range(of: "\\?\\s*$", options: .regularExpression) != nil { return true }

        let triggers = [
            "search","look up","google","find out","find me","show me","tell me","check","what about",
            "latest","today","tonight","yesterday","this week","this month","this year","right now",
            "currently","current","recent","recently","tomorrow","upcoming","last night","last week",
            "last month","last year","live ",
            "score","scores","standings","playoffs","championship","who won","who lost","results","highlights",
            "game","match","final","season","trade","signed",
            "news","headline","breaking","update","weather","forecast","temperature",
            "price","stock","crypto","bitcoin","ethereum","market","shares","index","earnings",
            "inflation","fed","dow","nasdaq",
            "president","prime minister","ceo","founder","owner","senator","governor","mayor",
            "how much","how many","how old","when is","when does","when did","where is","where does",
            "how long","how far","how tall",
            "tell me about","what happened","catch me up","info on","details about","background on",
            "history of","biography","bio of","summary of",
            "wiki","wikipedia","encyclopedia","define","definition",
            "trending","viral","released","box office","top 10","best ",
            "near me","hours of","phone number","address of","directions"
        ]
        return triggers.contains(where: { lower.contains($0) })
    }

    static func isAmbiguousFollowup(_ msg: String, historyLen: Int) -> Bool {
        guard historyLen >= 2 else { return false }
        let lower = msg.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        if lower.range(of: "\\b(it|its|that|this|they|them|those|these|there|their|he|she|his|her|him)\\b", options: .regularExpression) != nil { return true }
        if lower.range(of: "\\b(till|until|by then|since then|what about|how about|and (you|then)|more about|same|also|too|instead)\\b", options: .regularExpression) != nil { return true }
        if msg.split(whereSeparator: { $0.isWhitespace }).count <= 5 { return true }
        return false
    }

    static func rewriteSearchQuery(message: String, history: [ChatMessage]) async -> String? {
        guard APIKeys.has(.gemini) else { return nil }
        let last = history.suffix(6)
        guard last.count >= 2 else { return nil }
        let ctx = last.map { "\($0.role == "assistant" ? "assistant" : "user"): \(String($0.content.prefix(400)))" }.joined(separator: "\n")
        let prompt = """
        Rewrite the user's latest message into a standalone web search query. Expand pronouns ("it", "that", "they", "there") using the conversation. Keep proper nouns, dates, and numbers. If the latest message already stands alone, return it unchanged. Output ONLY the rewritten query on a single line — no quotes, no explanation.

        Conversation:
        \(ctx)

        Latest message: \(message)

        Standalone search query:
        """
        do {
            var rewritten = try await DirectAPI.geminiGenerate(prompt: prompt, maxTokens: 100)
            rewritten = rewritten.trimmingCharacters(in: CharacterSet(charactersIn: "\"'` \n\t"))
            rewritten = String(rewritten.prefix(while: { $0 != "\n" }))
            guard rewritten.count >= 2, rewritten.count <= 300,
                  rewritten.lowercased() != message.lowercased().trimmingCharacters(in: .whitespaces) else {
                return nil
            }
            return rewritten
        } catch {
            return nil
        }
    }

    // MARK: - Time block

    static func currentTimeBlock() -> String {
        let d = Date()
        let tz = TimeZone.current.identifier
        let f = DateFormatter()
        f.dateStyle = .full
        f.timeStyle = .short
        f.timeZone = TimeZone.current
        let dateStr = f.string(from: d)
        let hour = Calendar.current.component(.hour, from: d)
        let period: String
        switch hour {
        case 0..<6: period = "LATE NIGHT"
        case 6..<12: period = "MORNING"
        case 12..<17: period = "AFTERNOON"
        case 17..<21: period = "EVENING"
        default: period = "NIGHT"
        }
        return """
        CURRENT DATE/TIME (ground truth — the REAL time on the user's device, NOT your training cutoff):
          Date: \(dateStr)
          Period: \(period)
          Timezone: \(tz)
          Epoch: \(Int(d.timeIntervalSince1970))
        Do NOT guess the time — use exactly this.
        """
    }

    // MARK: - City extraction (weather helper)

    static func extractCity(from message: String) -> String? {
        let patterns = [
            "(?:weather|forecast|temperature|rain|snow|wind|storm|humidity)\\s+(?:in|for|at|near)\\s+([a-zA-Z\\s,]+?)(?:\\?|$|\\.|\\!)",
            "(?:in|for|at|near)\\s+([A-Z][a-zA-Z\\s,]+?)(?:\\?|$|\\.|\\!)"
        ]
        for p in patterns {
            if let re = try? NSRegularExpression(pattern: p, options: [.caseInsensitive]),
               let m = re.firstMatch(in: message, range: NSRange(message.startIndex..., in: message)),
               m.numberOfRanges >= 2,
               let r = Range(m.range(at: 1), in: message) {
                return String(message[r])
            }
        }
        return nil
    }

    // MARK: - Command-block post-processing

    /// Strip ```command …``` fences from the LLM's reply so the user
    /// doesn't see raw JSON.
    static func stripCommandBlocks(_ text: String) -> String {
        guard let re = try? NSRegularExpression(pattern: "```command\\s*\\n?[\\s\\S]*?\\n?```", options: []) else { return text }
        let range = NSRange(text.startIndex..., in: text)
        return re.stringByReplacingMatches(in: text, range: range, withTemplate: "")
    }

    /// Parse any command blocks emitted by the LLM and execute the ones
    /// we support on-device (remember, forget, wiki_ingest). Commands that
    /// need a server (falcon_eye, computer_use, scheduling) are no-ops.
    static func processCommandBlocks(_ text: String) {
        guard let re = try? NSRegularExpression(pattern: "```command\\s*\\n?([\\s\\S]*?)\\n?```", options: []) else { return }
        let range = NSRange(text.startIndex..., in: text)
        let matches = re.matches(in: text, range: range)
        for m in matches {
            guard m.numberOfRanges >= 2,
                  let r = Range(m.range(at: 1), in: text) else { continue }
            let jsonStr = String(text[r])
            guard let data = jsonStr.data(using: .utf8),
                  let cmd = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let action = cmd["action"] as? String else { continue }

            switch action {
            case "remember":
                if let content = cmd["content"] as? String {
                    let category = cmd["category"] as? String ?? "general"
                    _ = LocalStore.addMemory(content: content, category: category)
                }
            case "forget":
                if let id = cmd["id"] as? Int {
                    LocalStore.deleteMemory(id: id)
                }
            case "wiki_ingest":
                if let content = cmd["content"] as? String, !content.isEmpty {
                    let title = cmd["title"] as? String ?? "Untitled"
                    let id = "src-\(Int(Date().timeIntervalSince1970))"
                    let page = LocalStore.WikiPage(
                        id: id,
                        title: title,
                        content: content,
                        type: "source",
                        tags: [],
                        summary: String(content.prefix(120)),
                        updated: ISO8601DateFormatter().string(from: Date())
                    )
                    LocalStore.upsertWikiPage(page)
                }
            default:
                break // server-side actions ignored
            }
        }
    }
}
