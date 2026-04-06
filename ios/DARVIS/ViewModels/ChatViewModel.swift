import SwiftUI
import AVFoundation

@MainActor
class ChatViewModel: ObservableObject {
    @Published var messages: [ChatMessage] = []
    @Published var responseText: String = ""
    @Published var orbState: OrbState = .idle
    @Published var inputText: String = ""
    @Published var isRecording = false
    @Published var cameraActive = false
    @Published var audioMode: String = "classic"

    private var audioPlayer: AVAudioPlayer?

    init() {
        Task { await loadHistory() }
    }

    func loadHistory() async {
        do {
            messages = try await APIClient.shared.getHistory()
            let settings = try await APIClient.shared.getSettings()
            audioMode = settings.audio_mode
        } catch {}
    }

    func send() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        inputText = ""

        // Detect memory intent from user input
        detectAndSaveMemory(text)

        messages.append(ChatMessage(role: "user", content: text))
        orbState = .thinking
        responseText = ""

        Task {
            do {
                // If camera is active and it's a vision question, use vision API
                if cameraActive && looksLikeCameraRequest(text) {
                    // Camera vision handled by parent view
                    orbState = .idle
                    return
                }

                let response = try await APIClient.shared.sendChat(message: text)
                responseText = response.reply
                messages.append(ChatMessage(role: "assistant", content: response.reply))

                // Handle actions
                if let actions = response.actions {
                    for action in actions {
                        if action.action == "open_url", let urlStr = action.url, let url = URL(string: urlStr) {
                            await UIApplication.shared.open(url)
                        }
                        if action.action == "agent_started" {
                            NotificationCenter.default.post(name: .agentStarted, object: nil)
                        }
                    }
                }

                // Save to history
                try? await APIClient.shared.appendHistory(messages: [
                    ChatMessage(role: "user", content: text),
                    ChatMessage(role: "assistant", content: response.reply),
                ])

                // Classic TTS
                if audioMode == "classic" {
                    await playTTS(response.reply)
                }

            } catch {
                responseText = "Error: \(error.localizedDescription)"
                orbState = .idle
            }
        }
    }

    func playTTS(_ text: String) async {
        orbState = .speaking
        do {
            let audioData = try await APIClient.shared.fetchTTS(text: text)
            audioPlayer = try AVAudioPlayer(data: audioData)
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
            audioPlayer?.play()

            // Wait for playback to finish
            while audioPlayer?.isPlaying == true {
                try await Task.sleep(nanoseconds: 100_000_000)
            }
        } catch {}
        orbState = .idle
    }

    private func detectAndSaveMemory(_ text: String) {
        let lower = text.lowercased()
        let patterns: [(String, NSRegularExpression?)] = [
            ("remember", try? NSRegularExpression(pattern: "(?:remember|don'?t forget|save|note|memorize)\\s+(?:that\\s+)?(.+)", options: .caseInsensitive)),
            ("forget", try? NSRegularExpression(pattern: "(?:forget|delete|remove|erase)\\s+(?:the\\s+)?(?:memory\\s+)?(?:about\\s+)?(.+)", options: .caseInsensitive)),
        ]

        for (action, regex) in patterns {
            guard let regex = regex else { continue }
            let range = NSRange(text.startIndex..., in: text)
            if let match = regex.firstMatch(in: text, range: range),
               let captureRange = Range(match.range(at: 1), in: text) {
                let content = String(text[captureRange]).trimmingCharacters(in: .whitespacesAndNewlines)
                Task {
                    if action == "remember" {
                        try? await APIClient.shared.addMemory(content: content)
                    } else {
                        let memories = try? await APIClient.shared.getMemories()
                        if let mem = memories?.first(where: { $0.content.lowercased().contains(content.lowercased()) }) {
                            try? await APIClient.shared.deleteMemory(id: mem.id)
                        }
                    }
                }
                break
            }
        }
    }

    private func looksLikeCameraRequest(_ text: String) -> Bool {
        let lower = text.lowercased()
        let triggers = ["what do you see", "what can you see", "what's in front", "what is this",
                        "what's this", "what is that", "describe what", "look at this", "can you see",
                        "read this", "what does this say", "identify", "what color", "in front of me",
                        "camera", "looking at", "see this", "see that", "scan"]
        return triggers.contains(where: { lower.contains($0) })
    }
}

extension Notification.Name {
    static let agentStarted = Notification.Name("agentStarted")
}
