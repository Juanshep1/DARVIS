import SwiftUI

@MainActor
class AgentViewModel: ObservableObject {
    @Published var status = AgentStatus(active: false, goal: "", step: 0, thinking: "", done: false)
    @Published var screenshot: UIImage?
    @Published var isPolling = false

    private var timer: Timer?

    func startPolling() {
        guard timer == nil else { return }
        isPolling = true
        // Timer on main run loop
        DispatchQueue.main.async {
            self.timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
                Task { @MainActor in await self?.poll() }
            }
        }
        Task { await poll() }
    }

    func stopPolling() {
        timer?.invalidate()
        timer = nil
        isPolling = false
    }

    private func poll() async {
        do {
            status = try await APIClient.shared.getAgentStatus()
            if status.active || status.done {
                let data = try await APIClient.shared.getAgentScreenshot()
                if let img = UIImage(data: data) {
                    screenshot = img
                }
            }
        } catch {}
    }
}

struct AgentView: View {
    @StateObject private var vm = AgentViewModel()

    var body: some View {
        ZStack {
            Color.spectraBackground.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                HStack {
                    Text("SPECTRA BROWSER")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .tracking(2)
                        .foregroundColor(.spectraCyan)
                    Spacer()
                    Circle()
                        .fill(vm.status.active ? Color.spectraGreen : Color.spectraDim)
                        .frame(width: 8, height: 8)
                    Text(vm.status.active ? "LIVE" : "IDLE")
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .foregroundColor(vm.status.active ? .spectraGreen : .spectraDim)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(Color(red: 0.06, green: 0.06, blue: 0.12))

                // Screenshot
                if let img = vm.screenshot {
                    Image(uiImage: img)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .border(Color.spectraCyan.opacity(0.15), width: 1)
                } else {
                    VStack(spacing: 12) {
                        Image(systemName: "globe")
                            .font(.system(size: 40))
                            .foregroundColor(.spectraDim)
                        Text("No active session")
                            .font(.system(size: 13, design: .monospaced))
                            .foregroundColor(.spectraDim)
                        Text("Ask SPECTRA to browse a website")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(Color.spectraDim.opacity(0.6))
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.black)
                }

                // Footer
                VStack(alignment: .leading, spacing: 4) {
                    if !vm.status.goal.isEmpty {
                        Text(vm.status.goal)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(.spectraText)
                            .lineLimit(2)
                    }
                    if vm.status.active {
                        Text("Step \(vm.status.step) — \(vm.status.thinking)")
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundColor(.spectraDim)
                            .lineLimit(1)
                    } else if vm.status.done {
                        Text(vm.status.thinking)
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundColor(.spectraGreen)
                            .lineLimit(2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Color(red: 0.06, green: 0.06, blue: 0.12))
            }
        }
        .onAppear { vm.startPolling() }
        .onDisappear { vm.stopPolling() }
        .onReceive(NotificationCenter.default.publisher(for: .agentStarted)) { _ in
            vm.startPolling()
        }
    }
}
