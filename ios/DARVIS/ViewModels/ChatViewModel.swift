import SwiftUI
import AVFoundation
import Speech

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
    @Published var statusMessage: String = ""

    let audioService = AudioService()
    let cameraService = CameraService()
    let geminiLive = GeminiLiveService()
    let onDeviceLLM = OnDeviceLLM()

    // Speech recognition
    private let speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var speechEngine: AVAudioEngine?
    private var silenceTimer: Timer?
    private let silenceDelay: TimeInterval = 2.5 // seconds of silence before auto-send

    // Mode cycling
    var modeLabel: String {
        if useOnDevice { return "ON-DEVICE" }
        if audioMode == "gemini" { return "GEMINI" }
        return "CLOUD"
    }
    var modeIcon: String {
        if useOnDevice { return "cpu.fill" }
        if audioMode == "gemini" { return "bolt.fill" }
        return "cloud.fill"
    }
    var modeColor: Color {
        if useOnDevice { return .darvisOrange }
        if audioMode == "gemini" { return .darvisGreen }
        return .darvisCyan
    }

    func cycleMode() {
        if audioMode == "classic" && !useOnDevice {
            audioMode = "gemini"; useOnDevice = false
            Task { try? await APIClient.shared.updateSettings(AppSettings(model: "", voice_id: "", audio_mode: "gemini")) }
        } else if audioMode == "gemini" && !useOnDevice {
            audioMode = "classic"; useOnDevice = true
        } else {
            audioMode = "classic"; useOnDevice = false
            Task { try? await APIClient.shared.updateSettings(AppSettings(model: "", voice_id: "", audio_mode: "classic")) }
        }
    }

    init() {
        setupGeminiCallbacks()
        Task {
            await loadSettings()
            await loadBriefing()
        }
    }

    private func loadSettings() async {
        do {
            let settings = try await APIClient.shared.getSettings()
            audioMode = settings.audio_mode
            messages = try await APIClient.shared.getHistory()
        } catch {}
    }

    private func loadBriefing() async {
        do {
            let briefing = try await APIClient.shared.getBriefing()
            if !briefing.isEmpty {
                responseText = briefing
                await playTTS(briefing)
            }
        } catch {}
    }

    private func setupGeminiCallbacks() {
        geminiLive.onAudioChunk = { [weak self] data in
            self?.audioService.playPCM(data)
            Task { @MainActor in self?.orbState = .speaking }
        }
        geminiLive.onTurnComplete = { [weak self] in
            Task { @MainActor in
                guard let self = self else { return }
                self.orbState = self.isRecording ? .listening : .idle
                if !self.geminiLive.responseText.isEmpty {
                    self.responseText = self.geminiLive.responseText
                    try? await APIClient.shared.appendHistory(messages: [
                        ChatMessage(role: "assistant", content: self.geminiLive.responseText)
                    ])
                }
            }
        }
        geminiLive.onInterrupted = { [weak self] in
            self?.audioService.stopPCM()
            Task { @MainActor in self?.orbState = .listening }
        }
    }

    // MARK: - Permissions

    func requestPermissions() {
        // Mic
        AVAudioSession.sharedInstance().requestRecordPermission { _ in }
        // Speech
        SFSpeechRecognizer.requestAuthorization { _ in }
        // Camera requested on first use by CameraService
    }

    // MARK: - Send

    func send() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        inputText = ""
        detectAndSaveMemory(text)

        // Camera vision
        if cameraActive && looksLikeCameraRequest(text) {
            analyzeCamera(prompt: text)
            return
        }

        messages.append(ChatMessage(role: "user", content: text))
        orbState = .thinking
        responseText = ""

        Task {
            if useOnDevice {
                if let response = await onDeviceLLM.generate(prompt: text) {
                    responseText = response
                    messages.append(ChatMessage(role: "assistant", content: response))
                    await playTTS(response)
                } else {
                    responseText = "No response — check your connection, sir."
                }
                orbState = .idle
                return
            }

            if audioMode == "gemini" {
                if !geminiLive.isConnected { _ = await geminiLive.connect() }
                if geminiLive.isConnected {
                    geminiLive.responseText = ""
                    geminiLive.sendText(text)
                    try? await APIClient.shared.appendHistory(messages: [ChatMessage(role: "user", content: text)])
                    return
                }
                audioMode = "classic"
            }

            do {
                let response = try await APIClient.shared.sendChat(message: text)
                responseText = response.reply
                messages.append(ChatMessage(role: "assistant", content: response.reply))

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
                await playTTS(response.reply)
            } catch {
                responseText = "Error: \(error.localizedDescription)"
                orbState = .idle
            }
        }
    }

    // MARK: - Voice

    func toggleMic() {
        if isRecording {
            stopVoice()
        } else {
            startVoice()
        }
    }

    private func startVoice() {
        isRecording = true
        orbState = .listening

        if audioMode == "gemini" {
            Task {
                if !geminiLive.isConnected {
                    if !(await geminiLive.connect()) {
                        audioMode = "classic"
                        isRecording = false
                        orbState = .idle
                        statusMessage = "Gemini unavailable — switched to Classic"
                        return
                    }
                }
                audioService.onPCMChunk = { [weak self] b64 in
                    self?.geminiLive.sendAudio(pcmBase64: b64)
                }
                audioService.startCapture()
            }
        } else {
            startSpeechRecognition()
        }
    }

    private func stopVoice() {
        isRecording = false

        if audioMode == "gemini" {
            audioService.stopCapture()
        } else {
            stopSpeechRecognition()
            let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty {
                send()
                return
            }
        }
        orbState = .idle
    }

    private func startSpeechRecognition() {
        let authStatus = SFSpeechRecognizer.authorizationStatus()
        guard authStatus == .authorized else {
            SFSpeechRecognizer.requestAuthorization { [weak self] status in
                DispatchQueue.main.async {
                    if status == .authorized {
                        self?.startSpeechRecognition()
                    } else {
                        self?.statusMessage = "Speech recognition not authorized"
                        self?.isRecording = false
                        self?.orbState = .idle
                    }
                }
            }
            return
        }

        // Stop any existing recognition
        recognitionTask?.cancel()
        recognitionTask = nil

        // Fresh audio engine every time
        speechEngine = AVAudioEngine()
        guard let engine = speechEngine else { return }

        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            statusMessage = "Audio error: \(error.localizedDescription)"
            isRecording = false
            orbState = .idle
            return
        }

        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let request = recognitionRequest else { return }
        request.shouldReportPartialResults = true

        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else {
            statusMessage = "Microphone not available"
            isRecording = false
            orbState = .idle
            return
        }

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)
        }

        engine.prepare()
        do {
            try engine.start()
        } catch {
            statusMessage = "Mic start failed: \(error.localizedDescription)"
            isRecording = false
            orbState = .idle
            return
        }

        recognitionTask = speechRecognizer?.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }
            if let result = result {
                DispatchQueue.main.async {
                    self.inputText = result.bestTranscription.formattedString

                    // Reset silence timer on every new speech
                    self.silenceTimer?.invalidate()
                    self.silenceTimer = Timer.scheduledTimer(withTimeInterval: self.silenceDelay, repeats: false) { _ in
                        DispatchQueue.main.async {
                            if self.isRecording { self.stopVoice() }
                        }
                    }
                }
                // Also handle isFinal
                if result.isFinal {
                    DispatchQueue.main.async {
                        self.silenceTimer?.invalidate()
                        if self.isRecording { self.stopVoice() }
                    }
                }
            }
            if let error = error {
                // Ignore "no speech detected" — just means silence
                let nsError = error as NSError
                if nsError.domain == "kAFAssistantErrorDomain" && nsError.code == 1110 {
                    // No speech — auto-send what we have
                    DispatchQueue.main.async {
                        if self.isRecording { self.stopVoice() }
                    }
                    return
                }
                DispatchQueue.main.async {
                    if self.isRecording { self.stopVoice() }
                }
            }
        }
    }

    private func stopSpeechRecognition() {
        silenceTimer?.invalidate()
        silenceTimer = nil
        speechEngine?.stop()
        speechEngine?.inputNode.removeTap(onBus: 0)
        speechEngine = nil
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        recognitionTask?.cancel()
        recognitionTask = nil
    }

    // MARK: - Camera

    func toggleCamera() {
        if cameraActive {
            cameraService.stop()
            cameraActive = false
        } else {
            // Stop speech if running (audio session conflict)
            if isRecording && audioMode != "gemini" {
                stopSpeechRecognition()
                isRecording = false
                orbState = .idle
            }
            cameraService.start()
            // Wait for camera to actually be running before showing preview
            Task {
                for _ in 0..<20 { // Wait up to 2 seconds
                    try? await Task.sleep(nanoseconds: 100_000_000)
                    if cameraService.isActive {
                        cameraActive = true
                        return
                    }
                }
                cameraActive = cameraService.isActive
                if !cameraActive {
                    statusMessage = "Camera failed to start"
                }
            }
        }
    }

    func analyzeCamera(prompt: String) {
        orbState = .thinking
        responseText = "Looking..."

        // Small delay to ensure camera has a frame
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            guard let self = self else { return }
            guard let frame = self.cameraService.captureFrame() else {
                self.responseText = "Camera not ready — try again in a moment."
                self.orbState = .idle
                return
            }

            Task {
                if let desc = await self.onDeviceLLM.analyzeImage(base64JPEG: frame, prompt: prompt) {
                    self.responseText = desc
                    self.messages.append(ChatMessage(role: "assistant", content: desc))
                    if self.audioMode == "gemini" && self.geminiLive.isConnected {
                        self.geminiLive.sendText("Say this: \(desc)")
                    } else {
                        await self.playTTS(desc)
                    }
                } else {
                    do {
                        let desc = try await APIClient.shared.sendVision(imageBase64: frame, prompt: prompt)
                        self.responseText = desc
                        await self.playTTS(desc)
                    } catch {
                        self.responseText = "Vision failed."
                    }
                }
                self.orbState = .idle
            }
        }
    }

    // MARK: - TTS

    func playTTS(_ text: String) async {
        orbState = .speaking
        do {
            let audioData = try await APIClient.shared.fetchTTS(text: text)
            audioService.playMP3(audioData)
            while audioService.isPlayingMP3 {
                try await Task.sleep(nanoseconds: 200_000_000)
            }
        } catch {}
        if orbState == .speaking { orbState = .idle }
    }

    // MARK: - Memory

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
        return ["what do you see", "what can you see", "what's in front", "what is this",
                "what's this", "what is that", "describe what", "look at this", "can you see",
                "read this", "what does this say", "identify", "what color", "in front of me",
                "camera", "looking at", "see this", "see that", "scan"
        ].contains(where: { lower.contains($0) })
    }
}

extension Notification.Name {
    static let agentStarted = Notification.Name("agentStarted")
}
