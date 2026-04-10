import SwiftUI

struct MainTabView: View {
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            ChatView()
                .tabItem {
                    Image(systemName: "bubble.left.fill")
                    Text("Chat")
                }
                .tag(0)

            AgentView()
                .tabItem {
                    Image(systemName: "eye.fill")
                    Text("Agent")
                }
                .tag(1)

            MemoryView()
                .tabItem {
                    Image(systemName: "brain")
                    Text("Memory")
                }
                .tag(2)

            SettingsView()
                .tabItem {
                    Image(systemName: "gearshape.fill")
                    Text("Settings")
                }
                .tag(3)
        }
        .tint(.spectraCyan)
        .onReceive(NotificationCenter.default.publisher(for: .agentStarted)) { _ in
            selectedTab = 1 // Switch to Agent tab
        }
    }
}
