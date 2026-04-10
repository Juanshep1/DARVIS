import Foundation
import AVFoundation

// Gemini Live Audio — WebSocket speech-to-speech
@MainActor
class GeminiLiveService: ObservableObject {
    @Published var isConnected = false
    @Published var responseText = ""
    var voiceName = "Kore"

    private var webSocket: URLSessionWebSocketTask?
    private var session: URLSession?

    var onAudioChunk: ((Data) -> Void)?
    var onTurnComplete: (() -> Void)?
    var onInterrupted: (() -> Void)?

    func connect() async -> Bool {
        do {
            // Load voice preference
            voiceName = UserDefaults.standard.string(forKey: "geminiVoice") ?? "Kore"
            let tokenResp = try await APIClient.shared.getGeminiToken()
            let urlStr = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=\(tokenResp.token)"
            guard let url = URL(string: urlStr) else { return false }

            session = URLSession(configuration: .default)
            webSocket = session?.webSocketTask(with: url)
            webSocket?.resume()

            // Fetch memories for context
            var memoryCtx = ""
            if let memories = try? await APIClient.shared.getMemories(), !memories.isEmpty {
                memoryCtx = "\n\nUser memories:\n" + memories.map { "- [\($0.category)] \($0.content)" }.joined(separator: "\n")
            }

            // Send setup
            let setup: [String: Any] = [
                "setup": [
                    "model": "models/\(tokenResp.model)",
                    "generation_config": [
                        "response_modalities": ["AUDIO"],
                        "speech_config": [
                            "voice_config": [
                                "prebuilt_voice_config": ["voice_name": voiceName]
                            ]
                        ]
                    ],
                    "system_instruction": [
                        "parts": [["text": """
                        You are SPECTRA. Say your name as "Spectra" — never spell it out.
                        Dry-witted, efficient, British-accented. Addresses user as "sir" or "ma'am".
                        Keep responses concise (1-3 sentences).
                        You are running on the Gemini 2.5 Flash Native Audio model in Gemini Live mode on the iOS SPECTRA app. When asked what model you are, say Gemini 2.5 Flash Native Audio. You run across iPhone, browser, terminal, and Android — all share memory and history.\(memoryCtx)
                        """]]
                    ]
                ]
            ]

            let setupData = try JSONSerialization.data(withJSONObject: setup)
            try await webSocket?.send(.data(setupData))

            // Wait for setupComplete
            if let msg = try await receiveMessage() {
                if msg["setupComplete"] != nil {
                    isConnected = true
                    startReceiveLoop()
                    return true
                }
            }
            return false
        } catch {
            print("Gemini connect error: \(error)")
            return false
        }
    }

    func sendText(_ text: String) {
        guard let ws = webSocket else { return }
        let msg: [String: Any] = [
            "clientContent": [
                "turns": [["role": "user", "parts": [["text": text]]]],
                "turnComplete": true
            ]
        ]
        if let data = try? JSONSerialization.data(withJSONObject: msg) {
            ws.send(.data(data)) { _ in }
        }
    }

    func sendAudio(pcmBase64: String) {
        guard let ws = webSocket else { return }
        let msg: [String: Any] = [
            "realtimeInput": [
                "mediaChunks": [["data": pcmBase64, "mimeType": "audio/pcm;rate=16000"]]
            ]
        ]
        if let data = try? JSONSerialization.data(withJSONObject: msg) {
            ws.send(.data(data)) { _ in }
        }
    }

    func disconnect() {
        webSocket?.cancel(with: .normalClosure, reason: nil)
        webSocket = nil
        isConnected = false
    }

    private func receiveMessage() async throws -> [String: Any]? {
        guard let ws = webSocket else { return nil }
        let message = try await ws.receive()
        switch message {
        case .data(let data):
            return try JSONSerialization.jsonObject(with: data) as? [String: Any]
        case .string(let text):
            return try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any]
        @unknown default:
            return nil
        }
    }

    private func startReceiveLoop() {
        Task {
            while isConnected {
                do {
                    guard let msg = try await receiveMessage() else { continue }

                    if let sc = msg["serverContent"] as? [String: Any] {
                        // Interruption
                        if sc["interrupted"] as? Bool == true {
                            onInterrupted?()
                            continue
                        }

                        // Model turn
                        if let turn = sc["modelTurn"] as? [String: Any],
                           let parts = turn["parts"] as? [[String: Any]] {
                            for part in parts {
                                if let inlineData = part["inlineData"] as? [String: Any],
                                   let b64 = inlineData["data"] as? String,
                                   let audioData = Data(base64Encoded: b64) {
                                    onAudioChunk?(audioData)
                                }
                                if let text = part["text"] as? String {
                                    let clean = text.replacingOccurrences(of: "\\*\\*[^*]+\\*\\*\\n?", with: "", options: .regularExpression)
                                    if !clean.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                        responseText = clean.trimmingCharacters(in: .whitespacesAndNewlines)
                                    }
                                }
                            }
                        }

                        // Turn complete
                        if sc["turnComplete"] as? Bool == true {
                            onTurnComplete?()
                        }
                    }
                } catch {
                    isConnected = false
                    break
                }
            }
        }
    }
}
