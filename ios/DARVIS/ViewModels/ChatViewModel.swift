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
    @Published var useOnDevice = false

    let audioService = AudioService()
    let cameraService = CameraService()
    let geminiLive = GeminiLiveService()
    let onDeviceLLM = OnDeviceLLM()

    private var audioPlayer: AVAudioPlayer?

    init() {
        setupGeminiCallbacks()
        Task { await loadSettings() }
    }

    private func loadSettings() async {
        do {
            let settings = try await APIClient.shared.getSettings()
            audioMode = settings.audio_mode
            messages = try await APIClient.shared.getHistory()
        } catch {}
    }

    private func setupGeminiCallbacks() {
        geminiLive.onAudioChunk = { [weak self] data in
            self?.audioService.playPCM(data)
            Task { @MainActor in self?.orbState = .speaking }
        }
        geminiLive.onTurnComplete = { [weak self] in
            Task { @MainActor in
                self?.orbState = self?.isRecording == true ? .listening : .idle
                // Save to history
                if let text = self?.geminiLive.responseText, !text.isEmpty {
                    self?.responseText = text
                    try? await APIClient.shared.appendHistory(messages: [
                        ChatMessage(role: "assistant", content: text)
                    ])
                }
            }
        }
        geminiLive.onInterrupted = { [weak self] in
            self?.audioService.stopPCM()
            Task { @MainActor in self?.orbState = .listening }
        }
    }

    // MARK: - Send Message

    func send() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        inputText = ""

        // Detect memory intent
        detectAndSaveMemory(text)

        // Camera vision check
        if cameraActive && looksLikeCameraRequest(text) {
            analyzeCamera(prompt: text)
            return
        }

        messages.append(ChatMessage(role: "user", content: text))
        orbState = .thinking
        responseText = ""

        Task {
            // On-device mode
            if useOnDevice {
                if let response = await onDeviceLLM.generate(prompt: text) {
                    responseText = response
                    messages.append(ChatMessage(role: "assistant", content: response))
                    orbState = .idle
                    return
                }
            }

            // Gemini mode — send text via WebSocket
            if audioMode == "gemini" {
                if !geminiLive.isConnected {
                    let ok = await geminiLive.connect()
                    if !ok {
                        audioMode = "classic" // fallback
                    }
                }
                if geminiLive.isConnected {
                    geminiLive.responseText = ""
                    geminiLive.sendText(text)
                    try? await APIClient.shared.appendHistory(messages: [
                        ChatMessage(role: "user", content: text)
                    ])
                    return
                }
            }

            // Classic mode
            do {
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

                try? await APIClient.shared.appendHistory(messages: [
                    ChatMessage(role: "user", content: text),
                    ChatMessage(role: "assistant", content: response.reply),
                ])

                // TTS
                await playTTS(response.reply)
            } catch {
                responseText = "Error: \(error.localizedDescription)"
                orbState = .idle
            }
        }
    }

    // MARK: - Mic Toggle

    func toggleMic() {
        if isRecording {
            stopListening()
        } else {
            startListening()
        }
    }

    private func startListening() {
        isRecording = true
        orbState = .listening

        if audioMode == "gemini" {
            Task {
                if !geminiLive.isConnected {
                    let ok = await geminiLive.connect()
                    if !ok {
                        audioMode = "classic"
                        isRecording = false
                        orbState = .idle
                        return
                    }
                }
                audioService.onPCMChunk = { [weak self] b64 in
                    self?.geminiLive.sendAudio(pcmBase64: b64)
                }
                audioService.startCapture()
            }
        }
        // Classic mode: would use Speech framework (simplified for now)
    }

    private func stopListening() {
        isRecording = false
        audioService.stopCapture()
        if audioMode != "gemini" {
            orbState = .idle
        }
    }

    // MARK: - Camera

    func toggleCamera() {
        if cameraActive {
            cameraService.stop()
            cameraActive = false
        } else {
            cameraService.start()
            cameraActive = true
        }
    }

    func analyzeCamera(prompt: String) {
        guard let frame = cameraService.captureFrame() else {
            responseText = "Camera not ready."
            return
        }
        orbState = .thinking
        responseText = "Analyzing..."

        Task {
            if let description = await onDeviceLLM.analyzeImage(base64JPEG: frame, prompt: prompt) {
                responseText = description
                messages.append(ChatMessage(role: "assistant", content: description))

                // Speak it
                if audioMode == "gemini" && geminiLive.isConnected {
                    geminiLive.sendText("Say this to the user: \(description)")
                } else {
                    await playTTS(description)
                }
            } else {
                // Fallback to Ollama vision
                do {
                    let desc = try await APIClient.shared.sendVision(imageBase64: frame, prompt: prompt)
                    responseText = desc
                    await playTTS(desc)
                } catch {
                    responseText = "Vision failed."
                }
            }
            orbState = .idle
        }
    }

    // MARK: - TTS

    func playTTS(_ text: String) async {
        orbState = .speaking
        do {
            let audioData = try await APIClient.shared.fetchTTS(text: text)
            audioService.playMP3(audioData)
            while audioService.isPlayingMP3 {
                try await Task.sleep(nanoseconds: 100_000_000)
            }
        } catch {}
        orbState = .idle
    }

    // MARK: - Memory Detection

    private func detectAndSaveMemory(_ text: String) {
        let patterns: [(String, NSRegularExpression?)] = [
            ("save", try? NSRegularExpression(pattern: "(?:remember|don'?t forget|save|note|memorize)\\s+(?:that\\s+)?(.+)", options: .caseInsensitive)),
            ("forget", try? NSRegularExpression(pattern: "(?:forget|delete|remove|erase)\\s+(?:the\\s+)?(?:memory\\s+)?(?:about\\s+)?(.+)", options: .caseInsensitive)),
        ]

        for (action, regex) in patterns {
            guard let regex = regex else { continue }
            let range = NSRange(text.startIndex..., in: text)
            if let match = regex.firstMatch(in: text, range: range),
               let captureRange = Range(match.range(at: 1), in: text) {
                let content = String(text[captureRange]).trimmingCharacters(in: .whitespacesAndNewlines)
                Task {
                    if action == "save" {
                        try? await APIClient.shared.addMemory(content: content)
                    } else {
                        if let mems = try? await APIClient.shared.getMemories(),
                           let mem = mems.first(where: { $0.content.lowercased().contains(content.lowercased()) }) {
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
