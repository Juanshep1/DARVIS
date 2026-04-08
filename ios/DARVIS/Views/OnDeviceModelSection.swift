import SwiftUI

struct OnDeviceModelSection: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "bolt.fill")
                    .foregroundColor(.darvisGreen)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Gemini 2.5 Flash")
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundColor(.darvisText)
                    Text("Fast · Free · Always available")
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

            Text("On-device mode uses Gemini 2.5 Flash API — same Gemma 4 architecture, runs via Google's servers for free.")
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.darvisDim)
        }
    }
}
