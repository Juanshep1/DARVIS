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
    private let silenceDelay: TimeInterval = 5.0
    private var lastTranscript = ""
    private var stableCount = 0  // How many times the same transcript was seen

    // Cached regex
    private static let saveRegex = try? NSRegularExpression(pattern: "(?:remember|don'?t forget|save|note|memorize)\\s+(?:that\\s+)?(.+)", options: .caseInsensitive)
    private static let forgetRegex = try? NSRegularExpression(pattern: "(?:forget|delete|remove|erase)\\s+(?:the\\s+)?(?:memory\\s+)?(?:about\\s+)?(.+)", options: .caseInsensitive)

    // Mode cycling — 5 modes: classic → openrouter → local → gemini → gemma → classic
    private static let modes = ["classic", "openrouter", "local", "gemini", "gemma"]
    var modeLabel: String {
        switch audioMode {
        case "openrouter": return "OPENROUTER"
        case "local": return "LOCAL PI"
        case "gemini": return "GEMINI"
        case "gemma": return "GEMMA"
        default: return useOnDevice ? "ON-DEVICE" : "CLASSIC"
        }
    }
    var modeIcon: String {
        switch audioMode {
        case "openrouter": return "globe"
        case "local": return "desktopcomputer"
        case "gemini": return "bolt.fill"
        case "gemma": return "sparkles"
        default: return useOnDevice ? "cpu.fill" : "cloud.fill"
        }
    }
    var modeColor: Color {
        switch audioMode {
        case "openrouter": return .gilt
        case "local": return .stateLive
        case "gemini": return .stateLive
        case "gemma": return .gilt
        default: return useOnDevice ? .stateWarn : .gilt
        }
    }

    func cycleMode() {
        phoneControl.haptic(.light)
        useOnDevice = false
        let current = Self.modes.firstIndex(of: audioMode) ?? 0
        let next = (current + 1) % Self.modes.count
        audioMode = Self.modes[next]
        Task { try? await APIClient.shared.updateSettings(AppSettings(model: "", voice_id: "", audio_mode: audioMode)) }
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
            // Only update orbState once (not on every chunk)
            Task { @MainActor in
                if self?.orbState != .speaking { self?.orbState = .speaking }
            }
        }
        geminiLive.onTurnComplete = { [weak self] in
            Task { @MainActor in
                guard let self = self else { return }
                self.orbState = self.isRecording ? .listening : .idle
                if !self.geminiLive.responseText.isEmpty {
                    self.responseText = self.geminiLive.responseText
                    self.messages.append(ChatMessage(role: "assistant", content: self.geminiLive.responseText))
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

            // ── OpenRouter mode ──
            if audioMode == "openrouter" {
                do {
                    let orModel = UserDefaults.standard.string(forKey: "openRouterModel") ?? "anthropic/claude-sonnet-4"
                    var req = URLRequest(url: URL(string: "https://darvis1.netlify.app/api/openrouter/chat")!)
                    req.httpMethod = "POST"
                    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    req.httpBody = try JSONEncoder().encode(["message": text, "model": orModel])
                    req.timeoutInterval = 60
                    let (data, _) = try await URLSession.shared.data(for: req)
                    struct ORReply: Decodable { let reply: String? }
                    let reply = (try? JSONDecoder().decode(ORReply.self, from: data))?.reply ?? "No response."
                    responseText = reply
                    messages.append(ChatMessage(role: "assistant", content: reply))
                    await sendResponseNotificationIfBackgrounded(reply)
                    await playTTS(reply)
                } catch {
                    responseText = "OpenRouter error: \(error.localizedDescription)"
                }
                orbState = .idle
                return
            }

            // ── Local Pi mode (polling) ──
            if audioMode == "local" {
                let piAddr = UserDefaults.standard.string(forKey: "piAddress") ?? "juanspi5.tailc0f840.ts.net"
                let isHostname = piAddr.contains(".") && !piAddr.range(of: #"^\d+\.\d+\.\d+\.\d+$"#, options: .regularExpression).map({ _ in true }) ?? false
                let piBase = isHostname ? "https://\(piAddr)" : "http://\(piAddr):2414"
                do {
                    // Step 1: POST — starts the job, returns instantly with an ID
                    var req = URLRequest(url: URL(string: "\(piBase)/api/chat")!)
                    req.httpMethod = "POST"
                    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    req.httpBody = try JSONEncoder().encode(["message": text])
                    req.timeoutInterval = 30
                    let (startData, _) = try await URLSession.shared.data(for: req)
                    struct StartReply: Decodable { let id: String?; let reply: String? }
                    let startReply = try JSONDecoder().decode(StartReply.self, from: startData)

                    // If the Pi returned a reply directly (old web.py), use it
                    if let directReply = startReply.reply, !directReply.isEmpty {
                        responseText = directReply
                        messages.append(ChatMessage(role: "assistant", content: directReply))
                        await playTTS(directReply)
                        orbState = .idle
                        return
                    }

                    guard let jobId = startReply.id else {
                        responseText = "Pi returned no job ID."
                        orbState = .idle
                        return
                    }

                    // Step 2: Poll every 2s until done (max 90 attempts = 3 min)
                    responseText = "Pi is thinking…"
                    for attempt in 1...90 {
                        try await Task.sleep(nanoseconds: 2_000_000_000)
                        responseText = "Pi is thinking… \(attempt * 2)s"
                        let pollURL = URL(string: "\(piBase)/api/chat/status?id=\(jobId)")!
                        let (pollData, _) = try await URLSession.shared.data(from: pollURL)
                        struct PollReply: Decodable { let status: String?; let reply: String? }
                        if let poll = try? JSONDecoder().decode(PollReply.self, from: pollData), poll.status == "done" {
                            let reply = poll.reply ?? "No response from Pi."
                            responseText = reply
                            messages.append(ChatMessage(role: "assistant", content: reply))
                            await sendResponseNotificationIfBackgrounded(reply)
                            await playTTS(reply)
                            orbState = .idle
                            return
                        }
                    }
                    responseText = "Pi timed out after 3 minutes."
                } catch {
                    responseText = "Pi error: \(error.localizedDescription)"
                }
                orbState = .idle
                return
            }

            if audioMode == "gemini" {
                if !geminiLive.isConnected {
                    statusMessage = "Connecting to Gemini..."
                    let connected = await geminiLive.connect()
                    if !connected {
                        audioMode = "classic"
                        statusMessage = "Gemini unavailable — using Classic"
                        // Fall through to classic mode below
                    }
                }
                if geminiLive.isConnected {
                    geminiLive.responseText = ""
                    geminiLive.sendText(text)
                    // Save history in background (non-blocking)
                    Task.detached {
                        try? await APIClient.shared.appendHistory(messages: [ChatMessage(role: "user", content: text)])
                    }
                    // Set timeout — if no response in 30s, reset state
                    Task {
                        try? await Task.sleep(nanoseconds: 30_000_000_000)
                        if self.orbState == .thinking {
                            self.orbState = .idle
                            self.responseText = "Gemini didn't respond. Try again."
                        }
                    }
                    return
                }
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

                // History is saved by the chat.mjs endpoint — no need to double-save

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
            // Only send if we have a real sentence (3+ words, not noise)
            let wordCount = text.split(separator: " ").count
            if wordCount >= 2 && text.count >= 5 {
                send()
                return
            } else {
                inputText = ""  // Clear garbage
            }
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

        lastTranscript = ""
        stableCount = 0

        recognitionTask = speechRecognizer?.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self, self.isRecording else { return }

            if let result = result {
                let transcript = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)

                // Ignore noise: must be 4+ chars and 2+ words
                let words = transcript.split(separator: " ")
                guard transcript.count >= 4 && words.count >= 2 else { return }

                DispatchQueue.main.async {
                    guard self.isRecording else { return }
                    self.inputText = transcript

                    // Track if transcript has stabilized (same text seen multiple times = user stopped)
                    if transcript == self.lastTranscript {
                        self.stableCount += 1
                    } else {
                        self.lastTranscript = transcript
                        self.stableCount = 0
                    }

                    // Reset silence timer on every new result
                    self.silenceTimer?.invalidate()
                    self.silenceTimer = Timer.scheduledTimer(withTimeInterval: self.silenceDelay, repeats: false) { _ in
                        DispatchQueue.main.async {
                            guard self.isRecording else { return }
                            // Only auto-send if transcript is stable (not still changing)
                            let text = self.inputText.trimmingCharacters(in: .whitespacesAndNewlines)
                            let finalWords = text.split(separator: " ").count
                            if finalWords >= 2 && self.stableCount >= 1 {
                                self.stopVoice()
                            }
                            // Otherwise just keep listening
                        }
                    }
                }

                // Apple says user finished speaking
                if result.isFinal {
                    DispatchQueue.main.async {
                        guard self.isRecording else { return }
                        self.silenceTimer?.invalidate()
                        self.stopVoice()
                    }
                }
            }
            if error != nil {
                DispatchQueue.main.async {
                    if self.isRecording { self.stopVoice() }
                }
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

        // Always stop mic before TTS — prevents feedback loop
        let wasRecording = isRecording
        if wasRecording || speechEngine != nil {
            isRecording = false
            stopSpeechRecognition()
        }
        silenceTimer?.invalidate()
        silenceTimer = nil

        orbState = .speaking
        do {
            let data = try await APIClient.shared.fetchTTS(text: text)
            guard data.count > 100 else { orbState = .idle; return }

            // Playback mode (no mic input)
            let session = AVAudioSession.sharedInstance()
            try? session.setCategory(.playback, mode: .default)
            try? session.setActive(true)

            audioService.playMP3(data)
            for _ in 0..<150 {
                try await Task.sleep(nanoseconds: 200_000_000)
                if !audioService.isPlayingMP3 { break }
            }
        } catch {}

        // After TTS: go to idle. Do NOT auto-restart mic.
        // User must tap mic button again to start listening.
        orbState = .idle
        inputText = ""
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
        let triggers = [
            // Device control
            "brightness", "volume", "flashlight", "torch", "mute", "silent",
            "do not disturb", "dnd", "focus mode", "wifi settings", "bluetooth settings",
            // Info
            "clipboard", "battery", "device info", "phone info",
            // Apps
            "open settings", "open safari", "open maps", "open map", "open messages",
            "open phone", "open mail", "open camera", "open music", "open photos",
            "open calendar", "open notes", "open reminders", "open clock", "open timer",
            "open weather", "open wallet", "open facetime", "open files", "open shortcuts",
            "open health", "open app store", "open youtube", "open instagram", "open twitter",
            "open x app", "open tiktok", "open whatsapp", "open snapchat", "open telegram",
            "open discord", "open reddit", "open netflix", "open amazon", "open uber",
            "open lyft", "open doordash", "open spotify", "open texts", "open email",
            "open dialer", "open gallery",
            // Maps & navigation
            "directions to", "navigate to", "take me to", "drive to", "how to get to",
            "route to", "nearby", "near me", "nearest", "closest", "drop a pin", "drop pin",
            "how far", "eta to", "distance to", "traffic", "where am i", "share my location",
            "show me", "find a ", "find an ", "find me",
            // Music
            "play ", "pause music", "pause song", "stop music", "resume music", "resume song",
            "next song", "next track", "skip song", "skip track", "previous song", "previous track",
            "last song", "go back", "what's playing", "what song", "now playing", "current song",
            "shuffle", "repeat", "on spotify", "on soundcloud", "youtube music",
            // Communication
            "call ", "text ", "message ", "facetime ",
            // Timers
            "set a timer", "set timer", "start a timer", "set an alarm", "set alarm", "stopwatch",
        ]
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
