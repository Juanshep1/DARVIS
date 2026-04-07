import SwiftUI

struct OnDeviceModelSection: View {
    @ObservedObject var dm = ModelDownloadManager.shared
    @EnvironmentObject var llm: OnDeviceLLM

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Download Gemma to run DARVIS directly on your iPhone. No internet needed after download.")
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.darvisDim)

            if llm.isLoaded {
                HStack(spacing: 6) {
                    Image(systemName: "bolt.fill")
                        .foregroundColor(.darvisGreen)
                    Text(llm.currentModelName)
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundColor(.darvisGreen)
                }
                .padding(10)
                .background(Color.darvisGreen.opacity(0.05))
                .cornerRadius(8)
            }

            ForEach(AVAILABLE_MODELS) { model in
                modelRow(model)
            }

            if dm.isDownloading {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("Downloading \(dm.currentDownload ?? "model")...")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundColor(.darvisOrange)
                        Spacer()
                        Button("Cancel") { dm.cancelDownload() }
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .foregroundColor(.darvisRed)
                    }
                    ProgressView(value: dm.downloadProgress)
                        .tint(.darvisCyan)
                    Text("\(Int(dm.downloadProgress * 100))%")
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundColor(.darvisDim)
                }
                .padding(10)
                .background(Color.darvisOrange.opacity(0.05))
                .cornerRadius(8)
            }

            if dm.downloadComplete {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill").foregroundColor(.darvisGreen)
                    Text("Downloaded! Tap 'Load' to activate.")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(.darvisGreen)
                }
            }

            if let error = dm.errorMessage {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.darvisRed)
                    Text(error)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(.darvisRed)
                        .lineLimit(2)
                }
            }
        }
    }

    private func modelRow(_ model: LocalModel) -> some View {
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

            if dm.isModelDownloaded(model) {
                HStack(spacing: 8) {
                    Button(action: { Task { _ = await llm.loadModel(model) } }) {
                        Text(llm.isLoaded && llm.currentModelName.contains(model.name) ? "Active" : "Load")
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .foregroundColor(llm.isLoaded && llm.currentModelName.contains(model.name) ? .darvisGreen : .darvisCyan)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background((llm.isLoaded && llm.currentModelName.contains(model.name) ? Color.darvisGreen : Color.darvisCyan).opacity(0.1))
                            .cornerRadius(6)
                    }
                    Button(action: { dm.deleteModel(model) }) {
                        Image(systemName: "trash")
                            .foregroundColor(.darvisRed.opacity(0.7))
                            .font(.system(size: 12))
                    }
                }
            } else if !dm.isDownloading {
                Button(action: { dm.downloadModel(model) }) {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.down.circle.fill")
                        Text("Download")
                    }
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundColor(.darvisCyan)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color.darvisCyan.opacity(0.1))
                    .cornerRadius(8)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
