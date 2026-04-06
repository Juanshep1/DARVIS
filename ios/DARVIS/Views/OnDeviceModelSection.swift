import SwiftUI

struct OnDeviceModelSection: View {
    @StateObject private var dm = ModelDownloadManager()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Download a model to run DARVIS offline on your iPhone.")
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.darvisDim)

            ForEach(AVAILABLE_MODELS) { model in
                modelRow(model)
            }

            // Download progress
            if dm.isDownloading {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("Downloading \(dm.currentDownload ?? "")...")
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
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.darvisGreen)
                        .font(.system(size: 16))
                    Button(action: { dm.deleteModel(model) }) {
                        Image(systemName: "trash")
                            .foregroundColor(.darvisRed.opacity(0.7))
                            .font(.system(size: 14))
                    }
                }
            } else if !dm.isDownloading {
                Button(action: { dm.downloadModel(model) }) {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.down.circle")
                        Text("Download")
                    }
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
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
}
