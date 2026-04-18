import SwiftUI

struct ChatView: View {
    @StateObject private var vm = ChatViewModel()
    @State private var currentTime = ""

    let dateTimer = Timer.publish(every: 15, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            // ── Leather ground ──
            Color.paper.ignoresSafeArea()

            // Subtle oil-lamp glow from above
            RadialGradient(
                colors: [Color.gilt.opacity(0.06), Color.clear],
                center: .init(x: 0.5, y: 0.2),
                startRadius: 0,
                endRadius: 400
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                // ── Almanac Masthead ──
                VStack(spacing: 6) {
                    Text("Spectra")
                        .font(.almanacMasthead(48))
                        .foregroundColor(.ink)
                        .shadow(color: Color.gilt.opacity(0.1), radius: 12)

                    // Sub-masthead date line
                    HStack(spacing: 10) {
                        Text(currentTime)
                            .font(.almanacMono(8))
                            .foregroundColor(.inkFaint)
                            .tracking(2)

                        Text("✦")
                            .font(.almanacBody(10))
                            .foregroundColor(.rubric)

                        // Mode indicator
                        Button(action: { vm.cycleMode() }) {
                            HStack(spacing: 4) {
                                Image(systemName: vm.modeIcon)
                                    .font(.system(size: 8))
                                Text(vm.modeLabel.uppercased())
                                    .font(.almanacMono(7, weight: .medium))
                                    .tracking(1.5)
                            }
                            .foregroundColor(.gilt)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(Color.paperWarm)
                            .overlay(Rectangle().stroke(Color.gilt.opacity(0.4), lineWidth: 0.5))
                        }
                    }
                }
                .padding(.top, 12)
                .padding(.bottom, 8)

                // Double rule
                VStack(spacing: 2) {
                    Rectangle().fill(Color.ink.opacity(0.3)).frame(height: 0.5)
                    Rectangle().fill(Color.ink.opacity(0.15)).frame(height: 0.5)
                }
                .padding(.horizontal, 30)

                // ── Orb — centered in its own fixed frame ──
                OrbView(state: vm.orbState)
                    .saturation(0.85)
                    .brightness(0.05)
                    .frame(maxWidth: .infinity)
                    .onTapGesture { vm.toggleMic() }
                    .padding(.top, 6)

                // ── Transcript — takes all remaining space ──
                VStack(spacing: 0) {
                    if !vm.responseText.isEmpty {
                        // Separator + label
                        Rectangle().fill(Color.paperEdge).frame(height: 0.5)
                            .padding(.horizontal, 40)

                        Text("TRANSCRIPT")
                            .font(.almanacMono(7))
                            .foregroundColor(.gilt)
                            .tracking(3)
                            .padding(.top, 10)
                            .padding(.bottom, 6)

                        ScrollViewReader { proxy in
                            ScrollView {
                                Text(vm.responseText)
                                    .font(.almanacBody(17))
                                    .foregroundColor(.ink)
                                    .lineSpacing(5)
                                    .multilineTextAlignment(.leading)
                                    .padding(.horizontal, 24)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .id("response")
                            }
                            .onChange(of: vm.responseText) {
                                proxy.scrollTo("response", anchor: .bottom)
                            }
                        }
                    } else {
                        Spacer(minLength: 20)
                        Text("The engine is idle, sir.\nTouch the orb to speak.")
                            .font(.almanacBodyItalic(14))
                            .foregroundColor(.inkGhost)
                            .multilineTextAlignment(.center)
                        Spacer()
                    }
                }
                .frame(maxHeight: .infinity)

                // ── Input bar ──
                InputBar(
                    text: $vm.inputText,
                    isRecording: vm.isRecording,
                    cameraActive: vm.cameraActive,
                    isFixing: vm.isFixing,
                    onSend: { vm.send() },
                    onMicToggle: { vm.toggleMic() },
                    onCameraToggle: { vm.toggleCamera() },
                    onFixYourself: { vm.fixYourself() }
                )
            }

            // ── Camera preview — bottom left ──
            if vm.cameraActive {
                VStack {
                    Spacer()
                    HStack {
                        ZStack(alignment: .topLeading) {
                            CameraPreviewView(session: vm.cameraService.captureSession)
                                .frame(width: 120, height: 160)
                                .clipShape(Rectangle())
                                .overlay(Rectangle().stroke(Color.gilt.opacity(0.5), lineWidth: 1))
                                .shadow(color: Color.paperFold, radius: 0, x: 3, y: 4)

                            Text("LIVE")
                                .font(.almanacMono(7, weight: .medium))
                                .foregroundColor(.stateLive)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 2)
                                .background(Color.paper.opacity(0.9))
                                .padding(4)
                        }
                        .padding(.leading, 14)
                        .padding(.bottom, 80)
                        Spacer()
                    }
                }
            }

            // ── Status toast ──
            if !vm.statusMessage.isEmpty {
                VStack {
                    Text(vm.statusMessage)
                        .font(.almanacMono(9))
                        .foregroundColor(.gilt)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Color.paperWarm)
                        .overlay(Rectangle().stroke(Color.gilt.opacity(0.4), lineWidth: 0.5))
                        .shadow(color: Color.paperFold, radius: 0, x: 2, y: 3)
                        .padding(.top, 55)
                    Spacer()
                }
                .transition(.move(edge: .top).combined(with: .opacity))
                .onAppear {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                        withAnimation { vm.statusMessage = "" }
                    }
                }
            }
        }
        .onAppear {
            vm.requestPermissions()
            updateTime()
        }
        .onReceive(dateTimer) { _ in updateTime() }
    }

    private func updateTime() {
        let f = DateFormatter()
        f.dateFormat = "EEEE · d MMMM · HH:mm 'Z'"
        f.timeZone = TimeZone(identifier: "UTC")
        currentTime = f.string(from: Date())
    }
}
ne: .now() + 3) {
                        withAnimation { vm.statusMessage = "" }
                    }
                }
            }
        }
        .onAppear {
            vm.requestPermissions()
            updateTime()
        }
        .onReceive(dateTimer) { _ in updateTime() }
    }

    private func updateTime() {
        let f = DateFormatter()
        f.dateFormat = "EEEE · d MMMM · HH:mm 'Z'"
        f.timeZone = TimeZone(identifier: "UTC")
        currentTime = f.string(from: Date())
    }
}
