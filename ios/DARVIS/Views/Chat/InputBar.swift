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
            TextField("Talk to SPECTRA...", text: $text)
                .textFieldStyle(.plain)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(Color(red: 0.06, green: 0.06, blue: 0.10))
                .cornerRadius(25)
                .overlay(RoundedRectangle(cornerRadius: 25).stroke(Color.spectraCyan.opacity(0.3), lineWidth: 1))
                .foregroundColor(.spectraText)
                .font(.system(.body, design: .monospaced))
                .onSubmit {
                    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                    onSend()
                }

            // Mic button
            Button(action: onMicToggle) {
                Image(systemName: isRecording ? "mic.fill" : "mic")
                    .font(.system(size: 18))
                    .foregroundColor(isRecording ? .spectraRed : .spectraCyan)
                    .frame(width: 44, height: 44)
                    .background(Color(red: 0.06, green: 0.06, blue: 0.10))
                    .clipShape(Circle())
                    .overlay(Circle().stroke(isRecording ? Color.spectraRed.opacity(0.5) : Color.spectraCyan.opacity(0.3), lineWidth: 1))
            }

            // Camera button
            Button(action: onCameraToggle) {
                Image(systemName: cameraActive ? "camera.fill" : "camera")
                    .font(.system(size: 16))
                    .foregroundColor(cameraActive ? .spectraGreen : .spectraCyan)
                    .frame(width: 44, height: 44)
                    .background(Color(red: 0.06, green: 0.06, blue: 0.10))
                    .clipShape(Circle())
                    .overlay(Circle().stroke(cameraActive ? Color.spectraGreen.opacity(0.5) : Color.spectraCyan.opacity(0.3), lineWidth: 1))
            }

            // Fix Yourself button
            Button(action: onFixYourself) {
                Image(systemName: "wrench.and.screwdriver")
                    .font(.system(size: 14))
                    .foregroundColor(.spectraOrange)
                    .frame(width: 44, height: 44)
                    .background(Color(red: 0.06, green: 0.06, blue: 0.10))
                    .clipShape(Circle())
                    .overlay(Circle().stroke(Color.spectraOrange.opacity(isFixing ? 0.8 : 0.3), lineWidth: 1))
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
