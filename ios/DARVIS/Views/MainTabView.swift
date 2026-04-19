import SwiftUI

struct MainTabView: View {
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            ChatView()
                .tabItem {
                    Label("Spectra", systemImage: "moon.stars")
                }
                .tag(0)

            AgentView()
                .tabItem {
                    Label("Agent", systemImage: "eye")
                }
                .tag(1)

            MemoryView()
                .tabItem {
                    Label("Archive", systemImage: "book.closed")
                }
                .tag(2)

            SettingsView()
                .tabItem {
                    Label("Ledger", systemImage: "gearshape")
                }
                .tag(3)

            // Falcon Eye — opens the browser
            Text("") // Placeholder view, immediately opens Safari
                .tabItem {
                    Label("Falcon Eye", systemImage: "globe.americas")
                }
                .tag(4)
                .onAppear {
                    // Falcon Eye is a web-only feature. URL is configurable
                    // so the user can point it at whichever host is live
                    // (Netlify, Cloudflare Pages, etc.) via UserDefaults key
                    // "falconEyeURL".
                    let urlStr = UserDefaults.standard.string(forKey: "falconEyeURL")
                        ?? "https://darvis1.netlify.app/falcon-eye/"
                    if let url = URL(string: urlStr) {
                        UIApplication.shared.open(url)
                    }
                    // Switch back to the previous tab
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        selectedTab = 0
                    }
                }
        }
        .tint(.gilt)
        .onReceive(NotificationCenter.default.publisher(for: .agentStarted)) { _ in
            selectedTab = 1
        }
    }
}
