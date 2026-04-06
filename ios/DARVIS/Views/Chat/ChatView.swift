import SwiftUI

struct ChatView: View {
    @StateObject private var vm = ChatViewModel()

    var body: some View {
        ZStack {
            Color.darvisBackground.ignoresSafeArea()

            VStack(spacing: 0) {
                // Title
                HStack {
                    Text("D . A . R . V . I . S .")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .tracking(5)
                        .foregroundColor(.darvisCyan)
                        .textCase(.uppercase)

                    Spacer()

                    // Mode toggle: Cloud → Gemini → On-Device → Cloud
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
                        .background(Color.darvisBackground)
                        .cornerRadius(4)
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(vm.modeColor.opacity(0.3), lineWidth: 0.5))
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)

                Spacer()

                // Orb
                OrbView(state: vm.orbState)
                    .onTapGesture { vm.toggleMic() }

                // Response text
                if !vm.responseText.isEmpty {
                    ScrollView {
                        Text(vm.responseText)
                            .font(.system(size: 15, design: .monospaced))
                            .foregroundColor(Color(red: 0.69, green: 0.77, blue: 0.87))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 24)
                    }
                    .frame(maxHeight: 160)
                    .padding(.top, 12)
                }

                Spacer()

                // Input bar
                InputBar(
                    text: $vm.inputText,
                    isRecording: vm.isRecording,
                    cameraActive: vm.cameraActive,
                    onSend: { vm.send() },
                    onMicToggle: { vm.toggleMic() },
                    onCameraToggle: { vm.toggleCamera() }
                )
            }

            // Camera preview (bottom-right corner — large and visible)
            if vm.cameraActive {
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        ZStack(alignment: .topLeading) {
                            CameraPreviewView(camera: vm.cameraService)
                                .frame(width: 200, height: 150)
                                .clipShape(RoundedRectangle(cornerRadius: 14))
                                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.darvisGreen.opacity(0.5), lineWidth: 2))
                                .shadow(color: .darvisGreen.opacity(0.2), radius: 15)

                            // Camera label
                            Text("CAMERA")
                                .font(.system(size: 7, weight: .bold, design: .monospaced))
                                .foregroundColor(.darvisGreen)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.black.opacity(0.7))
                                .cornerRadius(4)
                                .padding(6)
                        }
                        .padding(.trailing, 16)
                        .padding(.bottom, 90)
                    }
                }
            }
        }
    }
}
