import SwiftUI

struct ChatView: View {
    @StateObject private var vm = ChatViewModel()

    var body: some View {
        ZStack {
            Color.darvisBackground.ignoresSafeArea()

            VStack(spacing: 0) {
                // Title
                Text("D . A . R . V . I . S .")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .tracking(5)
                    .foregroundColor(.darvisCyan)
                    .textCase(.uppercase)
                    .padding(.top, 16)

                Spacer()

                // Orb
                OrbView(state: vm.orbState)
                    .onTapGesture { vm.isRecording.toggle() }

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
                    onMicToggle: { vm.isRecording.toggle() },
                    onCameraToggle: { vm.cameraActive.toggle() }
                )
            }

            // Mode indicator
            VStack {
                HStack {
                    Spacer()
                    Text(vm.audioMode == "gemini" ? "GEMINI" : "CLASSIC")
                        .font(.system(size: 8, weight: .bold, design: .monospaced))
                        .foregroundColor(vm.audioMode == "gemini" ? .darvisGreen : .darvisCyan)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.darvisBackground.opacity(0.8))
                        .cornerRadius(4)
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(
                            vm.audioMode == "gemini" ? Color.darvisGreen.opacity(0.3) : Color.darvisCyan.opacity(0.3), lineWidth: 0.5))
                        .padding(.trailing, 16)
                        .padding(.top, 8)
                }
                Spacer()
            }
        }
    }
}
