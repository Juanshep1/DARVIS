import SwiftUI

@MainActor
class MemoryViewModel: ObservableObject {
    @Published var memories: [Memory] = []
    @Published var newMemoryText = ""

    func load() async {
        do { memories = try await APIClient.shared.getMemories() } catch {}
    }

    func add() async {
        let text = newMemoryText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        do {
            try await APIClient.shared.addMemory(content: text)
            newMemoryText = ""
            await load()
        } catch {}
    }

    func delete(id: Int) async {
        do {
            try await APIClient.shared.deleteMemory(id: id)
            await load()
        } catch {}
    }
}

struct MemoryView: View {
    @StateObject private var vm = MemoryViewModel()

    var body: some View {
        ZStack {
            Color.spectraBackground.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                Text("MEMORY")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .tracking(3)
                    .foregroundColor(.spectraCyan)
                    .padding(.top, 16)

                // Add memory
                HStack(spacing: 8) {
                    TextField("Add a memory...", text: $vm.newMemoryText)
                        .textFieldStyle(.plain)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(Color(red: 0.06, green: 0.06, blue: 0.10))
                        .cornerRadius(10)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.spectraCyan.opacity(0.2), lineWidth: 1))
                        .foregroundColor(.spectraText)
                        .font(.system(size: 13, design: .monospaced))
                        .onSubmit { Task { await vm.add() } }

                    Button(action: { Task { await vm.add() } }) {
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 24))
                            .foregroundColor(.spectraCyan)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)

                // Memory list
                List {
                    ForEach(vm.memories) { mem in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(mem.content)
                                .font(.system(size: 13, design: .monospaced))
                                .foregroundColor(.spectraText)
                            Text(mem.category.uppercased())
                                .font(.system(size: 9, weight: .bold, design: .monospaced))
                                .foregroundColor(.spectraCyan)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.spectraCyan.opacity(0.1))
                                .cornerRadius(4)
                        }
                        .listRowBackground(Color(red: 0.06, green: 0.06, blue: 0.10))
                    }
                    .onDelete { indexSet in
                        for i in indexSet {
                            let mem = vm.memories[i]
                            Task { await vm.delete(id: mem.id) }
                        }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
        .task { await vm.load() }
    }
}
