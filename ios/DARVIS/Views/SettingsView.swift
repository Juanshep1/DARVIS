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
    @Published var geminiVoice: String = UserDefaults.standard.string(forKey: "geminiVoice") ?? "Kore" {
        didSet { UserDefaults.standard.set(geminiVoice, forKey: "geminiVoice") }
    }

    static let geminiVoices = [
        ("Kore", "Calm female (default)"),
        ("Puck", "Warm male"),
        ("Charon", "Deep male"),
        ("Fenrir", "Bold male"),
        ("Aoede", "Bright female"),
        ("Leda", "Soft female"),
        ("Orus", "Clear male"),
        ("Zephyr", "Breezy female"),
    ]

    func load() async {
        do {
            settings = try await APIClient.shared.getSettings()
            let m = try await APIClient.shared.getModels()
            models = m.models
            currentModel = m.current
            let v = try await APIClient.shared.getVoices()
            voices = v.voices
            currentVoice = v.current
        } catch {}
    }

    func setModel(_ model: String) async {
        settings.model = model
        do { try await APIClient.shared.updateSettings(settings) } catch {}
    }

    func setVoice(_ voiceId: String) async {
        settings.voice_id = voiceId
        do { try await APIClient.shared.updateSettings(settings) } catch {}
        // If custom ID not in voice list, add it
        if !voices.contains(where: { $0.id == voiceId }) {
            voices.append(VoiceOption(id: voiceId, name: "Custom (\(String(voiceId.prefix(8)))...)", category: "custom"))
        }
    }

    func setAudioMode(_ mode: String) async {
        settings.audio_mode = mode
        do { try await APIClient.shared.updateSettings(settings) } catch {}
    }
}

struct SettingsView: View {
    @StateObject private var vm = SettingsViewModel()

    var body: some View {
        ZStack {
            Color.spectraBackground.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("SETTINGS")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .tracking(3)
                        .foregroundColor(.spectraCyan)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 16)

                    // Audio Mode
                    settingSection("AUDIO MODE") {
                        Picker("Mode", selection: Binding(
                            get: { vm.settings.audio_mode },
                            set: { val in vm.settings.audio_mode = val; Task { await vm.setAudioMode(val) } }
                        )) {
                            Text("Classic (Ollama + ElevenLabs)").tag("classic")
                            Text("Gemini Live Audio").tag("gemini")
                        }
                        .pickerStyle(.segmented)
                        .tint(.spectraCyan)
                    }

                    // Model
                    settingSection("MODEL") {
                        Picker("Model", selection: Binding(
                            get: { vm.settings.model },
                            set: { val in vm.settings.model = val; Task { await vm.setModel(val) } }
                        )) {
                            ForEach(vm.models, id: \.self) { model in
                                Text(model).tag(model)
                            }
                        }
                        .pickerStyle(.menu)
                        .tint(.spectraCyan)
                    }

                    // Voice
                    if vm.settings.audio_mode == "classic" {
                        settingSection("VOICE") {
                            Picker("Voice", selection: Binding(
                                get: { vm.settings.voice_id },
                                set: { val in vm.settings.voice_id = val; Task { await vm.setVoice(val) } }
                            )) {
                                ForEach(vm.voices) { voice in
                                    Text("\(voice.name) (\(voice.category))").tag(voice.id)
                                }
                            }
                            .pickerStyle(.menu)
                            .tint(.spectraCyan)

                            // Custom voice ID input
                            HStack(spacing: 8) {
                                TextField("Paste ElevenLabs Voice ID...", text: $vm.customVoiceId)
                                    .textFieldStyle(.plain)
                                    .font(.system(size: 12, design: .monospaced))
                                    .foregroundColor(.spectraText)
                                    .padding(10)
                                    .background(Color(red: 0.06, green: 0.06, blue: 0.10))
                                    .cornerRadius(8)
                                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.spectraCyan.opacity(0.2), lineWidth: 1))

                                Button("Set") {
                                    let vid = vm.customVoiceId.trimmingCharacters(in: .whitespacesAndNewlines)
                                    guard !vid.isEmpty else { return }
                                    vm.settings.voice_id = vid
                                    Task { await vm.setVoice(vid) }
                                    vm.voiceStatus = "Voice ID set"
                                }
                                .font(.system(size: 11, weight: .bold, design: .monospaced))
                                .foregroundColor(.spectraCyan)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(Color.spectraCyan.opacity(0.1))
                                .cornerRadius(8)
                                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.spectraCyan.opacity(0.3), lineWidth: 1))
                            }

                            if !vm.voiceStatus.isEmpty {
                                Text(vm.voiceStatus)
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundColor(.spectraGreen)
                            }
                        }
                    }

                    // Gemini Voice (shown in gemini mode)
                    if vm.settings.audio_mode == "gemini" {
                        settingSection("GEMINI VOICE") {
                            Picker("Voice", selection: $vm.geminiVoice) {
                                ForEach(SettingsViewModel.geminiVoices, id: \.0) { voice in
                                    Text("\(voice.0) — \(voice.1)").tag(voice.0)
                                }
                            }
                            .pickerStyle(.menu)
                            .tint(.spectraCyan)
                        }
                    }

                    // On-Device Models
                    settingSection("ON-DEVICE MODELS") {
                        OnDeviceModelSection()
                    }

                    // Info
                    settingSection("STATUS") {
                        infoRow("Platform", "iOS")
                        infoRow("Backend", "darvis1.netlify.app")
                        infoRow("Audio", vm.settings.audio_mode == "gemini" ? "Gemini Live" : "Ollama + ElevenLabs")
                    }
                }
                .padding(.horizontal, 16)
            }
        }
        .task { await vm.load() }
    }

    @ViewBuilder
    private func settingSection(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .tracking(2)
                .foregroundColor(.spectraCyan.opacity(0.7))
            content()
                .padding(12)
                .hudCard()
        }
    }

    private func infoRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(.spectraDim)
            Spacer()
            Text(value)
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(.spectraText)
        }
    }
}
