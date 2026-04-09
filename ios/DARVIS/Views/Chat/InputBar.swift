import SwiftUI

struct InputBar: View {
    @Binding var text: String
    let isRecording: Bool
    let cameraActive: Bool
    let isFixing: Bool
    let onSend: () -> Void
    let onMicToggle: () -> Void
    let onCameraToggle: () -> Void
    let onFixYourself: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            TextField("Talk to DARVIS...", text: $text)
                .textFieldStyle(.plain)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(Color(red: 0.06, green: 0.06, blue: 0.10))
                .cornerRadius(25)
                .overlay(RoundedRectangle(cornerRadius: 25).stroke(Color.darvisCyan.opacity(0.3), lineWidth: 1))
                .foregroundColor(.darvisText)
                .font(.system(.body, design: .monospaced))
                .onSubmit {
                    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                    onSend()
                }

            // Mic button
            Button(action: onMicToggle) {
                Image(systemName: isRecording ? "mic.fill" : "mic")
                    .font(.system(size: 18))
                    .foregroundColor(isRecording ? .darvisRed : .darvisCyan)
                    .frame(width: 44, height: 44)
                    .background(Color(red: 0.06, green: 0.06, blue: 0.10))
                    .clipShape(Circle())
                    .overlay(Circle().stroke(isRecording ? Color.darvisRed.opacity(0.5) : Color.darvisCyan.opacity(0.3), lineWidth: 1))
            }

            // Camera button
            Button(action: onCameraToggle) {
                Image(systemName: cameraActive ? "camera.fill" : "camera")
                    .font(.system(size: 16))
                    .foregroundColor(cameraActive ? .darvisGreen : .darvisCyan)
                    .frame(width: 44, height: 44)
                    .background(Color(red: 0.06, green: 0.06, blue: 0.10))
                    .clipShape(Circle())
                    .overlay(Circle().stroke(cameraActive ? Color.darvisGreen.opacity(0.5) : Color.darvisCyan.opacity(0.3), lineWidth: 1))
            }

            // Fix Yourself button
            Button(action: onFixYourself) {
                Image(systemName: "wrench.and.screwdriver")
                    .font(.system(size: 14))
                    .foregroundColor(.darvisOrange)
                    .frame(width: 44, height: 44)
                    .background(Color(red: 0.06, green: 0.06, blue: 0.10))
                    .clipShape(Circle())
                    .overlay(Circle().stroke(Color.darvisOrange.opacity(isFixing ? 0.8 : 0.3), lineWidth: 1))
                    .opacity(isFixing ? 0.6 : 1.0)
                    .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: isFixing)
            }
            .disabled(isFixing)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(LinearGradient(colors: [.clear, .black.opacity(0.6)], startPoint: .top, endPoint: .bottom))
    }
}
