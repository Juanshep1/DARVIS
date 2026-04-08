import SwiftUI

struct OnDeviceModelSection: View {
    @ObservedObject var llm: OnDeviceLLM

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Download a model to run DARVIS offline on your iPhone. No internet needed after download.")
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.darvisDim)

            if llm.isLoaded {
                HStack(spacing: 6) {
                    Image(systemName: "bolt.fill")
                        .foregroundColor(.darvisGreen)
                    Text(llm.currentModelName)
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundColor(.darvisGreen)
                    Spacer()
                    Button("Unload") { llm.unloadModel() }
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .foregroundColor(.darvisRed)
                }
                .padding(10)
                .background(Color.darvisGreen.opacity(0.05))
                .cornerRadius(8)
            }

            ForEach(AVAILABLE_MODELS) { model in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.name)
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                            .foregroundColor(.darvisText)
                        Text("\(model.params) params  ·  \(model.size)")
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundColor(.darvisDim)
                    }
                    Spacer()

                    if !llm.isDownloading {
                        Button(action: { llm.downloadAndLoad(model) }) {
                            HStack(spacing: 4) {
                                Image(systemName: "arrow.down.circle.fill")
                                Text("Download & Run")
                            }
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .foregroundColor(.darvisCyan)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(Color.darvisCyan.opacity(0.1))
                            .cornerRadius(8)
                        }
                    }
                }
                .padding(.vertical, 4)
            }

            if llm.isDownloading {
                VStack(alignment: .leading, spacing: 6) {
                    Text(llm.statusMessage)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(.darvisOrange)
                    ProgressView(value: llm.downloadProgress)
                        .tint(.darvisCyan)
                }
                .padding(10)
                .background(Color.darvisOrange.opacity(0.05))
                .cornerRadius(8)
            }

            if !llm.statusMessage.isEmpty && !llm.isDownloading {
                Text(llm.statusMessage)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(llm.isLoaded ? .darvisGreen : .darvisDim)
            }
        }
    }
}
