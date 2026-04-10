import SwiftUI
import AVFoundation
import Speech
import UserNotifications
import UIKit

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
    let phoneControl = iPhoneControl.shared

    private let speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var speechEngine: AVAudioEngine?
    private var silenceTimer: Timer?
    private let silenceDelay: TimeInterval = 2.5

    // Cached regex
    private static let saveRegex = try? NSRegularExpression(pattern: "(?:remember|don'?t forget|save|note|memorize)\\s+(?:that\\s+)?(.+)", options: .caseInsensitive)
    private static let forgetRegex = try? NSRegularExpression(pattern: "(?:forget|delete|remove|erase)\\s+(?:the\\s+)?(?:memory\\s+)?(?:about\\s+)?(.+)", options: .caseInsensitive)

    // Mode cycling
    var modeLabel: String { useOnDevice ? "ON-DEVICE" : audioMode == "gemini" ? "GEMINI" : "CLOUD" }
    var modeIcon: String { useOnDevice ? "cpu.fill" : audioMode == "gemini" ? "bolt.fill" : "cloud.fill" }
    var modeColor: Color { useOnDevice ? .spectraOrange : audioMode == "gemini" ? .spectraGreen : .spectraCyan }

    func cycleMode() {
        phoneControl.haptic(.light)
        if audioMode == "classic" && !useOnDevice {
            audioMode = "gemini"; useOnDevice = false
            Task { try? await APIClient.shared.updateSettings(AppSettings(model: "", voice_id: "", audio_mode: "gemini")) }
        } else if audioMode == "gemini" {
            audioMode = "classic"; useOnDevice = true
        } else {
            audioMode = "classic"; useOnDevice = false
            Task { try? await APIClient.shared.updateSettings(AppSettings(model: "", voice_id: "", audio_mode: "classic")) }
        }
    }

    @Published var ambientMode = false

    init() {
        setupGeminiCallbacks()
        setupNotificationReply()
        Task { await loadSettings() }
        startBriefingSchedule()
        startAlertPolling()
    }

    // Poll for triggered alerts every 60s
    private func startAlertPolling() {
        // Request notification permission
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }

        Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self = self else { return }
                do {
                    let (data, _) = try await URLSession.shared.data(from: URL(string: "https://darvis1.netlify.app/api/alerts/triggered")!)
                    struct Triggered: Codable { let triggered: [AlertItem] }
                    struct AlertItem: Codable { let id: String; let type: String; let message: String }
                    let result = try JSONDecoder().decode(Triggered.self, from: data)
                    for alert in result.triggered {
                        self.statusMessage = "⚡ " + alert.message
                        self.responseText = "ALERT: " + alert.message

                        // Push notification (works even when app is in background)
                        let content = UNMutableNotificationContent()
                        content.title = "SPECTRA Alert"
                        content.body = alert.message
                        content.sound = .default
                        let request = UNNotificationRequest(
                            identifier: "spectra-alert-\(alert.id)",
                            content: content,
                            trigger: nil  // Deliver immediately
                        )
                        try? await UNUserNotificationCenter.current().add(request)

                        await self.playTTS(alert.message)
                    }
                } catch {}
            }
        }
    }

    // Check every 30s if it's 8:00 AM or 9:30 PM
    private func startBriefingSchedule() {
        Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            let now = Calendar.current.dateComponents([.hour, .minute], from: Date())
            let h = now.hour ?? 0
            let m = now.minute ?? 0
            if (h == 8 && m == 0) || (h == 21 && m == 30) {
                Task { @MainActor in await self?.runBriefing() }
            }
        }
    }

    func runBriefing() async {
        orbState = .thinking
        responseText = "Preparing briefing..."
        do {
            let briefing = try await APIClient.shared.getBriefing()
            if !briefing.isEmpty {
                responseText = briefing
                await playTTS(briefing)
            } else {
                responseText = "Briefing unavailable, sir."
                orbState = .idle
            }
        } catch {
            responseText = "Briefing error."
            orbState = .idle
        }
    }

    private func loadSettings() async {
        do {
            let settings = try await APIClient.shared.getSettings()
            audioMode = settings.audio_mode
            let history = try await APIClient.shared.getHistory()
            messages = Array(history.suffix(20)) // Only show last 20 for performance
        } catch {
            statusMessage = "Offline mode"
        }
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
                }
            }
        }
        geminiLive.onInterrupted = { [weak self] in
            self?.audioService.stopPCM()
            Task { @MainActor in self?.orbState = .listening }
        }
    }

    func requestPermissions() {
        AVAudioApplication.requestRecordPermission { _ in }
        SFSpeechRecognizer.requestAuthorization { _ in }
    }

    func dismissKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    // MARK: - Send

    func send() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        inputText = ""
        dismissKeyboard()
        phoneControl.haptic(.light)

        // Ambient mode: only process if "spectra" is in the text
        if ambientMode && !text.lowercased().contains("spectra") {
            return
        }

        detectAndSaveMemory(text)

        // On-demand briefing
        if text.lowercased().contains("briefing") || text.lowercased().contains("brief me") || text.lowercased().contains("news update") {
            Task { await runBriefing() }
            return
        }

        // iPhone control commands
        if isPhoneControlRequest(text) {
            let result = phoneControl.execute(text)
            responseText = result
            return
        }

        // Camera vision
        if cameraActive && looksLikeCameraRequest(text) {
            analyzeCamera(prompt: text)
            return
        }

        messages.append(ChatMessage(role: "user", content: text))
        orbState = .thinking
        responseText = ""

        // Background task keeps the request alive even if user leaves the app
        let app = UIApplication.shared
        var bgTask: UIBackgroundTaskIdentifier = .invalid
        bgTask = app.beginBackgroundTask(withName: "SpectraChat") {
            app.endBackgroundTask(bgTask)
            bgTask = .invalid
        }

        Task {
            defer {
                if bgTask != .invalid {
                    app.endBackgroundTask(bgTask)
                    bgTask = .invalid
                }
            }

            if useOnDevice {
                if let response = await onDeviceLLM.generate(prompt: text) {
                    responseText = response
                    messages.append(ChatMessage(role: "assistant", content: response))
                    await sendResponseNotificationIfBackgrounded(response)
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
                statusMessage = "Gemini unavailable — using Classic"
            }

            do {
                let response = try await APIClient.shared.sendChat(message: text)
                let reply = response.reply

                if reply.isEmpty {
                    responseText = "No response received."
                    orbState = .idle
                    return
                }

                responseText = reply
                messages.append(ChatMessage(role: "assistant", content: reply))

                // Send notification if app is backgrounded
                await sendResponseNotificationIfBackgrounded(reply)

                // Handle actions
                if let actions = response.actions {
                    for action in actions {
                        if action.action == "open_url", let urlStr = action.url {
                            phoneControl.openURL(urlStr)
                        }
                        if action.action == "agent_started" {
                            NotificationCenter.default.post(name: .agentStarted, object: nil)
                        }
                        if action.action == "scheduled" {
                            let content = UNMutableNotificationContent()
                            content.title = "SPECTRA Reminder"
                            content.body = action.task ?? action.goal ?? "Reminder"
                            content.sound = .default

                            if let atStr = action.at {
                                let fmt = ISO8601DateFormatter()
                                fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                                let date = fmt.date(from: atStr) ?? ISO8601DateFormatter().date(from: atStr)
                                if let date = date {
                                    let interval = max(date.timeIntervalSinceNow, 1)
                                    let trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
                                    let req = UNNotificationRequest(identifier: "spectra-reminder-\(UUID().uuidString.prefix(8))", content: content, trigger: trigger)
                                    Task { try? await UNUserNotificationCenter.current().add(req) }
                                    statusMessage = "Reminder set for \(date.formatted(date: .omitted, time: .shortened))"
                                }
                            }
                        }
                    }
                }

                // Save history in background
                Task.detached {
                    try? await APIClient.shared.appendHistory(messages: [
                        ChatMessage(role: "user", content: text),
                        ChatMessage(role: "assistant", content: reply),
                    ])
                }

                await playTTS(reply)
            } catch let error as URLError where error.code == .timedOut {
                responseText = "Request timed out, sir. Try again."
                await sendResponseNotificationIfBackgrounded("Request timed out. Try again.")
                orbState = .idle
            } catch {
                responseText = "Connection error, sir. (\(error.localizedDescription))"
                await sendResponseNotificationIfBackgrounded("Connection error: \(error.localizedDescription)")
                orbState = .idle
            }
        }
    }

    // MARK: - Voice

    func toggleMic() {
        phoneControl.haptic()
        if isRecording { stopVoice() } else { startVoice() }
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
                        statusMessage = "Gemini unavailable"
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
            if !text.isEmpty { send(); return }
        }
        orbState = .idle
    }

    private func startSpeechRecognition() {
        guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
            SFSpeechRecognizer.requestAuthorization { [weak self] status in
                DispatchQueue.main.async {
                    if status == .authorized { self?.startSpeechRecognition() }
                    else { self?.statusMessage = "Speech not authorized"; self?.isRecording = false; self?.orbState = .idle }
                }
            }
            return
        }

        recognitionTask?.cancel()
        speechEngine = AVAudioEngine()
        guard let engine = speechEngine else { return }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch { statusMessage = "Audio error"; isRecording = false; orbState = .idle; return }

        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let request = recognitionRequest else { return }
        request.shouldReportPartialResults = true

        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else { statusMessage = "No mic"; isRecording = false; orbState = .idle; return }

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)
        }

        engine.prepare()
        do { try engine.start() } catch { statusMessage = "Mic error"; isRecording = false; orbState = .idle; return }

        recognitionTask = speechRecognizer?.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }
            if let result = result {
                DispatchQueue.main.async {
                    self.inputText = result.bestTranscription.formattedString
                    self.silenceTimer?.invalidate()
                    self.silenceTimer = Timer.scheduledTimer(withTimeInterval: self.silenceDelay, repeats: false) { _ in
                        DispatchQueue.main.async { if self.isRecording { self.stopVoice() } }
                    }
                }
                if result.isFinal {
                    DispatchQueue.main.async { self.silenceTimer?.invalidate(); if self.isRecording { self.stopVoice() } }
                }
            }
            if error != nil {
                DispatchQueue.main.async { if self.isRecording { self.stopVoice() } }
            }
        }
    }

    private func stopSpeechRecognition() {
        silenceTimer?.invalidate(); silenceTimer = nil
        speechEngine?.stop(); speechEngine?.inputNode.removeTap(onBus: 0); speechEngine = nil
        recognitionRequest?.endAudio(); recognitionRequest = nil
        recognitionTask?.cancel(); recognitionTask = nil
    }

    // MARK: - Camera

    func toggleCamera() {
        phoneControl.haptic(.light)
        if cameraActive {
            cameraService.stop()
            cameraActive = false
        } else {
            if isRecording && audioMode != "gemini" { stopSpeechRecognition(); isRecording = false; orbState = .idle }
            cameraService.start()
            Task {
                for _ in 0..<20 {
                    try? await Task.sleep(nanoseconds: 100_000_000)
                    if cameraService.isActive { cameraActive = true; return }
                }
                cameraActive = cameraService.isActive
                if !cameraActive { statusMessage = "Camera failed" }
            }
        }
    }

    func analyzeCamera(prompt: String) {
        orbState = .thinking
        responseText = "Looking..."
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            guard let self = self, let frame = self.cameraService.captureFrame() else {
                self?.responseText = "Camera not ready — try again."
                self?.orbState = .idle
                return
            }
            Task {
                if let desc = await self.onDeviceLLM.analyzeImage(base64JPEG: frame, prompt: prompt) {
                    self.responseText = desc
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
                    } catch { self.responseText = "Vision failed." }
                }
                self.orbState = .idle
            }
        }
    }

    // MARK: - Background Notifications

    private func sendResponseNotificationIfBackgrounded(_ text: String) async {
        let state = UIApplication.shared.applicationState
        guard state != .active else { return }

        let content = UNMutableNotificationContent()
        content.title = "SPECTRA"
        // iOS supports up to 4KB in notification body — show the full response
        content.body = text.count > 4000 ? String(text.prefix(3997)) + "..." : text
        content.sound = .default
        content.categoryIdentifier = "SPECTRA_RESPONSE"  // Enables reply action

        let request = UNNotificationRequest(
            identifier: "spectra-response-\(UUID().uuidString.prefix(8))",
            content: content,
            trigger: nil
        )
        try? await UNUserNotificationCenter.current().add(request)
    }

    func setupNotificationReply() {
        NotificationDelegate.shared.onReply = { [weak self] reply in
            guard let self = self else { return }
            self.inputText = reply
            self.send()
        }
    }

    // MARK: - TTS

    func playTTS(_ text: String) async {
        guard !text.isEmpty else { orbState = .idle; return }
        orbState = .speaking
        do {
            let data = try await APIClient.shared.fetchTTS(text: text)
            guard data.count > 100 else { orbState = .idle; return }
            audioService.playMP3(data)
            // Poll with timeout (max 30s to avoid infinite hang)
            for _ in 0..<150 {
                try await Task.sleep(nanoseconds: 200_000_000)
                if !audioService.isPlayingMP3 { break }
            }
        } catch {}
        if orbState == .speaking { orbState = .idle }
    }

    // MARK: - Fix Yourself

    @Published var isFixing = false

    func fixYourself() {
        phoneControl.haptic(.medium)
        isFixing = true
        orbState = .thinking
        responseText = "Running diagnostics..."

        Task {
            var results: [String] = []
            var fixed: [String] = []

            // 1. Backend
            do {
                _ = try await APIClient.shared.getSettings()
                results.append("Backend: ✓ OK")
            } catch {
                results.append("Backend: ✗ Unreachable")
            }

            // 2. Ollama Cloud (models)
            responseText = "🔧 Checking Ollama Cloud..."
            do {
                _ = try await APIClient.shared.getModels()
                results.append("Ollama Cloud: ✓ OK")
            } catch {
                results.append("Ollama Cloud: ✗ Unreachable")
            }

            // 3. ElevenLabs (voices)
            responseText = "🔧 Checking ElevenLabs..."
            do {
                _ = try await APIClient.shared.getVoices()
                results.append("ElevenLabs: ✓ OK")
            } catch {
                results.append("ElevenLabs: ✗ Unreachable")
            }

            // 4. Gemini API key
            responseText = "🔧 Checking Gemini..."
            do {
                let token = try await APIClient.shared.getGeminiToken()
                results.append(token.token.isEmpty ? "Gemini API: ✗ No key" : "Gemini API: ✓ OK")
            } catch {
                results.append("Gemini API: ✗ Unreachable")
            }

            // 5. Mic permission
            let micStatus = AVAudioApplication.shared.recordPermission
            switch micStatus {
            case .granted: results.append("Mic: ✓ granted")
            case .denied: results.append("Mic: ✗ denied")
            default: results.append("Mic: ⚠ not determined")
            }

            // 6. Camera permission
            let camStatus = AVCaptureDevice.authorizationStatus(for: .video)
            switch camStatus {
            case .authorized: results.append("Camera: ✓ granted")
            case .denied, .restricted: results.append("Camera: ✗ denied")
            default: results.append("Camera: ⚠ not determined")
            }

            // 7. Reset stuck states
            responseText = "🔧 Resetting stuck states..."
            if isRecording && speechEngine == nil && !geminiLive.isConnected {
                isRecording = false
                fixed.append("reset stuck recording")
            }
            if geminiLive.isConnected {
                // Test if actually alive by checking state
                results.append("Gemini Live: ✓ connected")
            } else if audioMode == "gemini" {
                results.append("Gemini Live: ⚠ not connected")
                audioMode = "classic"
                fixed.append("switched to Classic mode")
            }
            silenceTimer?.invalidate()
            silenceTimer = nil

            // 8. Audio session reset
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playback, mode: .default)
                try session.setActive(true)
                fixed.append("reset audio session")
            } catch {}

            // Summary
            let fixedStr = fixed.isEmpty ? "✓ No issues found." : "🔧 Fixed: " + fixed.joined(separator: ", ")
            responseText = "DIAGNOSTICS COMPLETE\n\n" + results.joined(separator: "\n") + "\n\n" + fixedStr
            orbState = .idle
            isFixing = false
        }
    }

    // MARK: - iPhone Control Detection

    private func isPhoneControlRequest(_ text: String) -> Bool {
        let lower = text.lowercased()
        let triggers = ["brightness", "volume", "flashlight", "torch", "open settings",
                        "open safari", "open maps", "open messages", "open phone", "open mail",
                        "open camera", "open music", "open photos", "clipboard", "battery",
                        "device info", "phone info", "mute", "silent"]
        return triggers.contains(where: { lower.contains($0) })
    }

    // MARK: - Memory

    private func detectAndSaveMemory(_ text: String) {
        let range = NSRange(text.startIndex..., in: text)
        if let regex = Self.saveRegex, let match = regex.firstMatch(in: text, range: range),
           let r = Range(match.range(at: 1), in: text) {
            let content = String(text[r]).trimmingCharacters(in: .whitespacesAndNewlines)
            Task { try? await APIClient.shared.addMemory(content: content) }
            return
        }
        if let regex = Self.forgetRegex, let match = regex.firstMatch(in: text, range: range),
           let r = Range(match.range(at: 1), in: text) {
            let content = String(text[r]).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            Task {
                if let mems = try? await APIClient.shared.getMemories(),
                   let mem = mems.first(where: { $0.content.lowercased().contains(content) }) {
                    try? await APIClient.shared.deleteMemory(id: mem.id)
                }
            }
        }
    }

    private func looksLikeCameraRequest(_ text: String) -> Bool {
        let lower = text.lowercased()
        return ["what do you see", "what can you see", "what's in front", "what is this",
                "describe what", "look at this", "can you see", "read this", "what does this say",
                "identify", "what color", "in front of me", "camera", "looking at", "scan"
        ].contains(where: { lower.contains($0) })
    }
}

extension Notification.Name {
    static let agentStarted = Notification.Name("agentStarted")
}
