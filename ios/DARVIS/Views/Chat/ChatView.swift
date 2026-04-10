import SwiftUI

struct ChatView: View {
    @StateObject private var vm = ChatViewModel()

    var body: some View {
        ZStack {
            Color.spectraBackground.ignoresSafeArea()

            VStack(spacing: 0) {
                // Title bar
                HStack {
                    Text("S.P.E.C.T.R.A.")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .tracking(5)
                        .foregroundColor(.spectraCyan)
                        .textCase(.uppercase)

                    Spacer()

                    Button(action: { vm.cycleMode() }) {
                        HStack(spacing: 4) {
                            Image(systemName: vm.modeIcon)
                                .font(.system(size: 9))
                            Text(vm.modeLabel)
                                .font(.system(size: 8, weight: .bold, design: .monospaced))
                        }
                        .foregroundColor(vm.modeColor)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.spectraBackground)
                        .cornerRadius(4)
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(vm.modeColor.opacity(0.3), lineWidth: 0.5))
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)

                // Orb area — takes up available space, orb centered
                GeometryReader { geo in
                    VStack(spacing: 0) {
                        Spacer()

                        // Orb
                        OrbView(state: vm.orbState)
                            .onTapGesture { vm.toggleMic() }

                        // Response text — sits below orb, scrollable, fills remaining space
                        ScrollViewReader { proxy in
                            ScrollView {
                                Text(vm.responseText)
                                    .font(.system(size: 14, design: .monospaced))
                                    .foregroundColor(Color(red: 0.69, green: 0.77, blue: 0.87))
                                    .multilineTextAlignment(.center)
                                    .padding(.horizontal, 20)
                                    .frame(maxWidth: .infinity)
                                    .id("response")
                            }
                            .frame(maxHeight: geo.size.height * 0.4) // Up to 40% of orb area
                            .opacity(vm.responseText.isEmpty ? 0 : 1)
                            .onChange(of: vm.responseText) {
                                proxy.scrollTo("response", anchor: .bottom)
                            }
                        }
                        .padding(.top, 8)

                        Spacer()
                    }
                }

                // Input bar — pinned to bottom
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

            // Camera preview — bottom left so it doesn't overlap response text
            if vm.cameraActive {
                VStack {
                    Spacer()
                    HStack {
                        ZStack(alignment: .topLeading) {
                            CameraPreviewView(session: vm.cameraService.captureSession)
                                .frame(width: 130, height: 175)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.spectraGreen.opacity(0.5), lineWidth: 2))
                                .shadow(color: .spectraGreen.opacity(0.2), radius: 10)

                            Text("LIVE")
                                .font(.system(size: 7, weight: .bold, design: .monospaced))
                                .foregroundColor(.spectraGreen)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 2)
                                .background(Color.black.opacity(0.7))
                                .cornerRadius(3)
                                .padding(5)
                        }
                        .padding(.leading, 12)
                        .padding(.bottom, 80)
                        Spacer()
                    }
                }
            }

            // Status message
            if !vm.statusMessage.isEmpty {
                VStack {
                    Text(vm.statusMessage)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(.spectraOrange)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color.black.opacity(0.8))
                        .cornerRadius(8)
                        .padding(.top, 50)
                    Spacer()
                }
                .onAppear {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { vm.statusMessage = "" }
                }
            }
        }
        .onAppear { vm.requestPermissions() }
    }
}
