import SwiftUI
import UserNotifications

class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationDelegate()
    var onReply: ((String) -> Void)?

    // Show notifications even when app is in foreground
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    // Handle reply action from notification
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        if response.actionIdentifier == "REPLY_ACTION",
           let textResponse = response as? UNTextInputNotificationResponse {
            let reply = textResponse.userText
            await MainActor.run {
                onReply?(reply)
            }
        }
    }
}

@main
struct SPECTRAApp: App {
    init() {
        // Almanac dark leather tab bar
        let tabBarAppearance = UITabBarAppearance()
        tabBarAppearance.configureWithOpaqueBackground()
        tabBarAppearance.backgroundColor = UIColor(red: 0.051, green: 0.039, blue: 0.027, alpha: 1) // paper #0d0a07
        // Gilt tint for selected items, ink-ghost for unselected
        let normalAttrs: [NSAttributedString.Key: Any] = [
            .foregroundColor: UIColor(red: 0.353, green: 0.329, blue: 0.267, alpha: 1) // inkGhost
        ]
        let selectedAttrs: [NSAttributedString.Key: Any] = [
            .foregroundColor: UIColor(red: 0.831, green: 0.659, blue: 0.278, alpha: 1) // gilt
        ]
        tabBarAppearance.stackedLayoutAppearance.normal.titleTextAttributes = normalAttrs
        tabBarAppearance.stackedLayoutAppearance.selected.titleTextAttributes = selectedAttrs
        tabBarAppearance.stackedLayoutAppearance.normal.iconColor = UIColor(red: 0.353, green: 0.329, blue: 0.267, alpha: 1)
        tabBarAppearance.stackedLayoutAppearance.selected.iconColor = UIColor(red: 0.831, green: 0.659, blue: 0.278, alpha: 1)
        UITabBar.appearance().standardAppearance = tabBarAppearance
        UITabBar.appearance().scrollEdgeAppearance = tabBarAppearance

        // Register notification category with reply action
        let replyAction = UNTextInputNotificationAction(
            identifier: "REPLY_ACTION",
            title: "Reply to Spectra",
            textInputButtonTitle: "Send",
            textInputPlaceholder: "Talk to Spectra..."
        )
        let category = UNNotificationCategory(
            identifier: "SPECTRA_RESPONSE",
            actions: [replyAction],
            intentIdentifiers: []
        )
        UNUserNotificationCenter.current().setNotificationCategories([category])
        UNUserNotificationCenter.current().delegate = NotificationDelegate.shared
    }

    var body: some Scene {
        WindowGroup {
            MainTabView()
                .preferredColorScheme(.dark)
        }
    }
}
