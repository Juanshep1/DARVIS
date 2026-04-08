import SwiftUI

struct OnDeviceModelSection: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("On-device mode uses Gemini 2.5 Flash — fast, free, no Ollama needed.")
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.darvisDim)

            HStack(spacing: 8) {
                Image(systemName: "bolt.fill")
                    .foregroundColor(.darvisGreen)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Gemini 2.5 Flash")
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundColor(.darvisText)
                    Text("Direct API · ~2s responses · Free tier")
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundColor(.darvisDim)
                }
                Spacer()
                Text("Active")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundColor(.darvisGreen)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.darvisGreen.opacity(0.1))
                    .cornerRadius(6)
            }
        }
    }
}
