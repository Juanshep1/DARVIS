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
struct DARVISApp: App {
    init() {
        // Dark tab bar
        let tabBarAppearance = UITabBarAppearance()
        tabBarAppearance.configureWithOpaqueBackground()
        tabBarAppearance.backgroundColor = UIColor(red: 0.04, green: 0.04, blue: 0.06, alpha: 1)
        UITabBar.appearance().standardAppearance = tabBarAppearance
        UITabBar.appearance().scrollEdgeAppearance = tabBarAppearance

        // Register notification category with reply action
        let replyAction = UNTextInputNotificationAction(
            identifier: "REPLY_ACTION",
            title: "Reply to DARVIS",
            textInputButtonTitle: "Send",
            textInputPlaceholder: "Talk to DARVIS..."
        )
        let category = UNNotificationCategory(
            identifier: "DARVIS_RESPONSE",
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
