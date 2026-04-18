import SwiftUI

@MainActor
class SettingsViewModel: ObservableObject {
    @Published var settings = AppSettings(model: "glm-5", voice_id: "", audio_mode: "classic")
    @Published var models: [String] = []
    @Published var voices: [VoiceOption] = []
    @Published var currentModel = ""
    @Published var currentVoice = ""
    @Published var customVoiceId = ""
    @Published var voiceStatus = ""
    @Published var piAddress: String = UserDefaults.standard.string(forKey: "piAddress") ?? "juanspi5.tailc0f840.ts.net"
    @Published var ttsProvider: String = UserDefaults.standard.string(forKey: "ttsProvider") ?? "browser"
    @Published var geminiVoice: String = UserDefaults.standard.string(forKey: "geminiVoice") ?? "Kore" {
        didSet { UserDefaults.standard.set(geminiVoice, forKey: "geminiVoice") }
    }

    // OpenRouter
    @Published var openRouterModels: [(id: String, name: String, isFree: Bool)] = []
    @Published var openRouterModel: String = UserDefaults.standard.string(forKey: "openRouterModel") ?? "anthropic/claude-sonnet-4"

    static let geminiVoices = [
        ("Kore", "Calm female"), ("Puck", "Warm male"), ("Charon", "Deep male"),
        ("Fenrir", "Bold male"), ("Aoede", "Bright female"), ("Leda", "Soft female"),
        ("Orus", "Clear male"), ("Zephyr", "Breezy female"),
    ]

    static let ttsProviders = [
        ("browser", "Apple / System Voice"),
        ("edge", "Google Translate (free)"),
        ("streamelements", "StreamElements (free)"),
        ("elevenlabs", "ElevenLabs (paid)"),
    ]

    func load() async {
        do {
            settings = try await APIClient.shared.getSettings()
            let m = try await APIClient.shared.getModels()
            models = m.models; currentModel = m.current
            let v = try await APIClient.shared.getVoices()
            voices = v.voices; currentVoice = v.current
        } catch {}
    }

    func loadOpenRouterModels() async {
        guard openRouterModels.isEmpty else { return }
        do {
            let url = URL(string: "https://darvis1.netlify.app/api/openrouter/models")!
            let (data, _) = try await URLSession.shared.data(from: url)
            struct ORResponse: Decodable { let models: [ORModel]; let current: String }
            struct ORModel: Decodable { let id: String; let name: String; let isFree: Bool }
            let resp = try JSONDecoder().decode(ORResponse.self, from: data)
            openRouterModels = resp.models.map { ($0.id, $0.name, $0.isFree) }
            openRouterModel = resp.current
        } catch {}
    }

    func setModel(_ model: String) async {
        settings.model = model
        do { try await APIClient.shared.updateSettings(settings) } catch {}
    }
    func setVoice(_ voiceId: String) async {
        settings.voice_id = voiceId
        do { try await APIClient.shared.updateSettings(settings) } catch {}
    }
    func setAudioMode(_ mode: String) async {
        settings.audio_mode = mode
        do { try await APIClient.shared.updateSettings(settings) } catch {}
    }
    func savePiAddress(_ addr: String) {
        piAddress = addr
        UserDefaults.standard.set(addr, forKey: "piAddress")
    }
    func saveTtsProvider(_ p: String) {
        ttsProvider = p
        UserDefaults.standard.set(p, forKey: "ttsProvider")
    }
    func saveOpenRouterModel(_ m: String) {
        openRouterModel = m
        UserDefaults.standard.set(m, forKey: "openRouterModel")
        Task {
            var req = URLRequest(url: URL(string: "https://darvis1.netlify.app/api/openrouter/set-model")!)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONEncoder().encode(["model": m])
            _ = try? await URLSession.shared.data(for: req)
        }
    }
}

struct SettingsView: View {
    @StateObject private var vm = SettingsViewModel()

    var body: some View {
        ZStack {
            Color.paper.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Masthead
                    Text("Ledger")
                        .font(.almanacMasthead(32))
                        .foregroundColor(.ink)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 16)

                    // ── 01 // AUDIO MODE ──
                    AlmanacSectionHeader(number: "01", title: "Audio Mode")

                    Picker("Mode", selection: Binding(
                        get: { vm.settings.audio_mode },
                        set: { val in vm.settings.audio_mode = val; Task { await vm.setAudioMode(val) } }
                    )) {
                        Text("Classic").tag("classic")
                        Text("OpenRouter").tag("openrouter")
                        Text("Local Pi").tag("local")
                        Text("Gemini").tag("gemini")
                        Text("Gemma").tag("gemma")
                    }
                    .pickerStyle(.segmented)
                    .tint(.gilt)
                    .almanacCard()
                    .padding(.horizontal, 4)

                    // ── OpenRouter settings ──
                    if vm.settings.audio_mode == "openrouter" {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("OPENROUTER MODEL")
                                .font(.almanacMono(8, weight: .medium))
                                .foregroundColor(.gilt)
                                .tracking(2)
                            if vm.openRouterModels.isEmpty {
                                Button("Load Models…") { Task { await vm.loadOpenRouterModels() } }
                                    .font(.almanacMono(11))
                                    .foregroundColor(.gilt)
                            } else {
                                Picker("Model", selection: Binding(
                                    get: { vm.openRouterModel },
                                    set: { vm.saveOpenRouterModel($0) }
                                )) {
                                    ForEach(vm.openRouterModels, id: \.id) { m in
                                        Text("\(m.isFree ? "★ " : "")\(m.name)").tag(m.id)
                                    }
                                }
                                .pickerStyle(.menu)
                                .tint(.gilt)
                                .almanacCard()
                            }
                        }
                        .padding(.horizontal, 4)
                        .task { await vm.loadOpenRouterModels() }
                    }

                    // ── Local Pi settings ──
                    if vm.settings.audio_mode == "local" {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("PI ADDRESS")
                                .font(.almanacMono(8, weight: .medium))
                                .foregroundColor(.gilt)
                                .tracking(2)
                            HStack(spacing: 8) {
                                TextField("juanspi5.tailc0f840.ts.net", text: $vm.piAddress)
                                    .font(.almanacMono(13))
                                    .foregroundColor(.ink)
                                    .padding(10)
                                    .background(Color.paperWarm)
                                    .overlay(Rectangle().stroke(Color.gilt.opacity(0.3), lineWidth: 0.5))
                                    .onSubmit { vm.savePiAddress(vm.piAddress) }
                                Button("Save") { vm.savePiAddress(vm.piAddress) }
                                    .font(.almanacMono(10, weight: .medium))
                                    .foregroundColor(.gilt)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 10)
                                    .overlay(Rectangle().stroke(Color.gilt.opacity(0.5), lineWidth: 0.5))
                            }
                            Text("Your Pi via Tailscale Funnel. Works from anywhere.")
                                .font(.almanacBodyItalic(11))
                                .foregroundColor(.inkGhost)
                        }
                        .padding(.horizontal, 4)
                    }

                    // ── Gemini voice ──
                    if vm.settings.audio_mode == "gemini" {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("GEMINI VOICE")
                                .font(.almanacMono(8, weight: .medium))
                                .foregroundColor(.gilt)
                                .tracking(2)
                            Picker("Voice", selection: $vm.geminiVoice) {
                                ForEach(SettingsViewModel.geminiVoices, id: \.0) { v in
                                    Text("\(v.0) — \(v.1)").tag(v.0)
                                }
                            }
                            .pickerStyle(.menu)
                            .tint(.gilt)
                            .almanacCard()
                        }
                        .padding(.horizontal, 4)
                    }

                    // ── 02 // VOICE PROVIDER ──
                    AlmanacSectionHeader(number: "02", title: "Voice Provider")

                    Picker("TTS", selection: Binding(
                        get: { vm.ttsProvider },
                        set: { vm.saveTtsProvider($0) }
                    )) {
                        ForEach(SettingsViewModel.ttsProviders, id: \.0) { p in
                            Text(p.1).tag(p.0)
                        }
                    }
                    .pickerStyle(.menu)
                    .tint(.gilt)
                    .almanacCard()
                    .padding(.horizontal, 4)

                    // ── Classic model + voice (when in classic mode) ──
                    if vm.settings.audio_mode == "classic" {
                        AlmanacSectionHeader(number: "03", title: "Ollama Model")
                        Picker("Model", selection: Binding(
                            get: { vm.settings.model },
                            set: { val in vm.settings.model = val; Task { await vm.setModel(val) } }
                        )) {
                            ForEach(vm.models, id: \.self) { Text($0).tag($0) }
                        }
                        .pickerStyle(.menu)
                        .tint(.gilt)
                        .almanacCard()
                        .padding(.horizontal, 4)

                        if vm.ttsProvider == "elevenlabs" {
                            AlmanacSectionHeader(number: "04", title: "ElevenLabs Voice")
                            Picker("Voice", selection: Binding(
                                get: { vm.settings.voice_id },
                                set: { val in vm.settings.voice_id = val; Task { await vm.setVoice(val) } }
                            )) {
                                ForEach(vm.voices) { v in
                                    Text("\(v.name)").tag(v.id)
                                }
                            }
                            .pickerStyle(.menu)
                            .tint(.gilt)
                            .almanacCard()
                            .padding(.horizontal, 4)
                        }
                    }

                    // ── Falcon Eye ──
                    AlmanacSectionHeader(number: "05", title: "Falcon Eye")
                    Button(action: {
                        if let url = URL(string: "https://darvis1.netlify.app/falcon-eye/") {
                            UIApplication.shared.open(url)
                        }
                    }) {
                        HStack {
                            Text("♆")
                                .font(.almanacDisplay(20))
                            Text("Open Falcon Eye Command Center")
                                .font(.almanacMono(11, weight: .medium))
                                .tracking(1)
                        }
                        .foregroundColor(.gilt)
                        .frame(maxWidth: .infinity)
                        .padding(14)
                        .background(Color.paperWarm)
                        .overlay(Rectangle().stroke(Color.gilt.opacity(0.4), lineWidth: 0.5))
                    }
                    .padding(.horizontal, 4)

                    // ── Status ──
                    AlmanacSectionHeader(number: "06", title: "System Status")
                    VStack(alignment: .leading, spacing: 6) {
                        infoRow("Platform", "iOS")
                        infoRow("Backend", "darvis1.netlify.app")
                        infoRow("Audio", vm.settings.audio_mode)
                        infoRow("TTS", vm.ttsProvider)
                    }
                    .padding(12)
                    .almanacCard()
                    .padding(.horizontal, 4)

                    Spacer(minLength: 40)
                }
                .padding(.horizontal, 16)
            }
        }
        .task { await vm.load() }
    }

    private func infoRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label.uppercased())
                .font(.almanacMono(9))
                .foregroundColor(.inkFaint)
                .tracking(1.5)
            Spacer()
            Text(value)
                .font(.almanacMono(11))
                .foregroundColor(.ink)
        }
    }
}
