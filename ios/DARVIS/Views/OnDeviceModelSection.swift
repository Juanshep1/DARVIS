import SwiftUI

struct OnDeviceModelSection: View {
    @ObservedObject var dm = ModelDownloadManager.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Download Gemma 4 to run DARVIS offline on your iPhone.")
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.darvisDim)

            ForEach(AVAILABLE_MODELS) { model in
                modelRow(model)
            }

            // Download progress
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
                    Text(formatProgress(dm.downloadProgress))
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundColor(.darvisDim)
                }
                .padding(10)
                .background(Color.darvisOrange.opacity(0.05))
                .cornerRadius(8)
            }

            // Download complete
            if dm.downloadComplete {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.darvisGreen)
                    Text("Download complete! Model ready.")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(.darvisGreen)
                }
                .padding(10)
                .background(Color.darvisGreen.opacity(0.05))
                .cornerRadius(8)
            }

            // Error
            if let error = dm.errorMessage {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(.darvisRed)
                    Text(error)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(.darvisRed)
                }
                .padding(10)
                .background(Color.darvisRed.opacity(0.05))
                .cornerRadius(8)
            }
        }
        .onAppear { dm.setup(); dm.refreshDownloadedModels() }
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
                    VStack(spacing: 2) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.darvisGreen)
                            .font(.system(size: 18))
                        Text("Ready")
                            .font(.system(size: 8, design: .monospaced))
                            .foregroundColor(.darvisGreen)
                    }
                    Button(action: { dm.deleteModel(model) }) {
                        Image(systemName: "trash")
                            .foregroundColor(.darvisRed.opacity(0.7))
                            .font(.system(size: 14))
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
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.darvisCyan.opacity(0.3), lineWidth: 1))
                }
            }
        }
        .padding(.vertical, 6)
    }

    private func formatProgress(_ progress: Double) -> String {
        let pct = Int(progress * 100)
        if pct < 1 { return "Starting download..." }
        return "\(pct)% downloaded"
    }
}
