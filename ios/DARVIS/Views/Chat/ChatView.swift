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

                    // On-device toggle
                    Button(action: { vm.useOnDevice.toggle() }) {
                        HStack(spacing: 4) {
                            Image(systemName: vm.useOnDevice ? "cpu.fill" : "cloud.fill")
                                .font(.system(size: 9))
                            Text(vm.useOnDevice ? "ON-DEVICE" : vm.audioMode == "gemini" ? "GEMINI" : "CLOUD")
                                .font(.system(size: 8, weight: .bold, design: .monospaced))
                        }
                        .foregroundColor(vm.useOnDevice ? .darvisOrange : vm.audioMode == "gemini" ? .darvisGreen : .darvisCyan)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.darvisBackground)
                        .cornerRadius(4)
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(
                            vm.useOnDevice ? Color.darvisOrange.opacity(0.3) : Color.darvisCyan.opacity(0.2), lineWidth: 0.5))
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

            // Camera preview (bottom-right corner)
            if vm.cameraActive, let preview = vm.cameraService.previewImage {
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        Image(uiImage: preview)
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(width: 100, height: 75)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.darvisGreen.opacity(0.5), lineWidth: 1))
                            .padding(.trailing, 16)
                            .padding(.bottom, 90)
                    }
                }
            }
        }
    }
}
